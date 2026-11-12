/**
 * @kumi-avax/sdk/eerc: private balances and private sends in Kumi chats, on Ava Labs' official EncryptedERC
 * (eERC, converter mode over Kumi's TestUSDC, unmodified at ava-labs/EncryptedERC 8dc98cd).
 *
 * What it is for: a copier can pay the caller a private tip ("thanks for the call") and crewmates can settle up,
 * and nobody reading Fuji learns how much. The chat shows "sent privately, amount hidden"; the receiver's app
 * decrypts the amount, the sender's app decrypts its own copy, and Kumi's auditor key can decrypt every amount.
 *
 * The crypto core (BabyJubJub ElGamal, Poseidon ciphertexts, Groth16 proof inputs for the registration, transfer
 * and withdraw circuits) is the same code Juno on Avalanche ships, written against the circuits in the pinned
 * submodule. Proving is passed in (`Prover`) so the browser, the phone and Node each use their own snarkjs.
 *
 * Nothing secret leaves the caller. A member's eERC key is derived from one wallet signature over `keyMessage`,
 * so the same wallet always reopens the same private balance; Kumi never stores it.
 */
import { Base8, addPoint, mulPointEscalar, subOrder, type Point } from '@zk-kit/baby-jubjub';
import { poseidonDecrypt, poseidonEncrypt } from '@zk-kit/poseidon-cipher';
import { poseidon3 } from 'poseidon-lite';
import {
  concat, decodeAbiParameters, decodeEventLog, decodeFunctionData, encodeAbiParameters, keccak256, toHex,
  type Address, type Hex, type PublicClient,
} from 'viem';

import { encryptedErcAbi, registrarAbi } from './eerc-abi.ts';

export { encryptedErcAbi, registrarAbi };

/** Kumi's eERC runs at 2 decimals (cents). TestUSDC has 6, so the converter keeps 1 tUSDC = 100 private units. */
export const EERC_DECIMALS = 2;
const SCALE = 10_000n; // 1e6 / 1e2
/** tUSDC base units (1e6) to private units (1e2). Shield amounts must be whole cents or the converter returns dust. */
export const toPrivateUnits = (usdc1e6: bigint) => usdc1e6 / SCALE;
export const fromPrivateUnits = (units: bigint) => units * SCALE;
/** 1234n -> "12.34" */
export function fmtPrivate(units: bigint): string {
  const neg = units < 0n;
  const a = neg ? -units : units;
  return `${neg ? '-' : ''}${(a / 100n).toLocaleString('en-US')}.${(a % 100n).toString().padStart(2, '0')}`;
}
/** "12.34" -> 1234n (whole cents only). */
export function parsePrivate(text: string): bigint | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

/** BN254 scalar field (circuit field). */
export const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type Keypair = {
  /** The circuit's SenderPrivateKey: a BabyJubJub scalar below the subgroup order. */
  secret: bigint;
  publicKey: [bigint, bigint];
};

export type Circuit = 'registration' | 'transfer' | 'withdraw';
export type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
export type Prover = (circuit: Circuit, input: Record<string, unknown>) => Promise<{ proof: SnarkProof; publicSignals: string[] }>;
export type ContractProof<N extends number = number> = {
  proofPoints: { a: [bigint, bigint]; b: [[bigint, bigint], [bigint, bigint]]; c: [bigint, bigint] };
  publicSignals: bigint[] & { length: N };
};

/* ------------------------------------------------------------------ */
/* Keys                                                                 */
/* ------------------------------------------------------------------ */

/** The message a holder signs once to open their private balance. Bound to the account and the chain. */
export function keyMessage(account: Address, chainId: number): string {
  return [
    'Kumi: open your private balance',
    '',
    'Signing this derives your eERC key on this device. It is not a transaction and costs nothing.',
    'Anyone with this signature can read your private balance and private sends, so only sign it inside Kumi.',
    '',
    `Account: ${account.toLowerCase()}`,
    `Chain: ${chainId}`,
  ].join('\n');
}

/**
 * A BabyJubJub scalar from 256 bits of seed. The circuits only need
 * SenderPrivateKey below the subgroup order with SenderPublicKey = sk·Base8;
 * reducing a keccak output mod the ~2^251 order keeps it uniform enough.
 */
export function keypairFromSeed(seed: bigint): Keypair {
  const secret = seed % subOrder || 1n;
  const p = mulPointEscalar(Base8, secret);
  return { secret, publicKey: [p[0], p[1]] };
}

/** A wallet signature (deterministic for RFC 6979 wallets such as Core and MetaMask) becomes the seed, domain-separated. */
export function keypairFromSignature(signature: Hex): Keypair {
  return keypairFromSeed(BigInt(keccak256(concat([toHex('kumi:eerc-key:v1'), signature]))));
}

/** CRH(CHAIN_ID | PRIVATE_KEY | ADDRESS), the registration circuit's public hash. */
export function registrationHash(k: Keypair, account: Address, chainId: number | bigint): bigint {
  return poseidon3([BigInt(chainId), k.secret, BigInt(account)]);
}

/* ------------------------------------------------------------------ */
/* ElGamal and Poseidon ciphertexts                                     */
/* ------------------------------------------------------------------ */

/** Uniform in [1, limit) by rejection sampling on limit's bit length. */
function randomBelow(limit: bigint): bigint {
  const bits = limit.toString(2).length;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  const excess = BigInt(bytes.length * 8 - bits);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    n >>= excess;
    if (n > 0n && n < limit) return n;
  }
}

const P = (p: readonly bigint[]): Point<bigint> => [p[0]!, p[1]!];

/** ElGamal on BabyJubJub: (r·G, m·G + r·pub). */
export function elgamalEncrypt(publicKey: readonly bigint[], message: bigint, random = randomBelow(subOrder)) {
  const c1 = mulPointEscalar(Base8, random);
  const c2 = addPoint(mulPointEscalar(Base8, message), mulPointEscalar(P(publicKey), random));
  return { c1, c2, random };
}

/** m·G = c2 − secret·c1. */
export function elgamalDecryptPoint(k: Keypair, c1: readonly bigint[], c2: readonly bigint[]): Point<bigint> {
  const s = mulPointEscalar(P(c1), k.secret);
  return addPoint(P(c2), [(SNARK_FIELD - s[0]) % SNARK_FIELD, s[1]]);
}

export type Pct = bigint[]; // [ciphertext(4), authKey(2), nonce]

/** Poseidon-encrypt `values` to `publicKey`; returns the 7-word PCT plus what the circuits need to check it. */
export function encryptPct(values: bigint[], publicKey: readonly bigint[]) {
  const nonce = randomBelow(1n << 128n) + 1n;
  const random = randomBelow(subOrder);
  const sharedKey = mulPointEscalar(P(publicKey), random);
  const authKey = mulPointEscalar(Base8, random);
  const ciphertext = poseidonEncrypt(values, sharedKey, nonce);
  return { pct: [...ciphertext, authKey[0], authKey[1], nonce] as Pct, ciphertext, authKey, nonce, random };
}

/** Decrypt a 7-word PCT with the holder's (or the auditor's) key. Throws if it was not encrypted to this key. */
export function decryptPct(k: Keypair, pct: readonly bigint[], length = 1): bigint[] {
  if (pct.length !== 7) throw Error('A PCT has 7 words.');
  const sharedKey = mulPointEscalar([pct[4]!, pct[5]!], k.secret);
  return poseidonDecrypt(pct.slice(0, 4), sharedKey, pct[6]!, length).slice(0, length);
}

const isZero = (pct: readonly bigint[]) => pct.every((w) => w === 0n);

/* ------------------------------------------------------------------ */
/* Reading a private balance                                                        */
/* ------------------------------------------------------------------ */

export type EncryptedBalance = {
  c1: [bigint, bigint];
  c2: [bigint, bigint];
  nonce: bigint;
  amountPCTs: { pct: bigint[]; index: bigint }[];
  balancePCT: bigint[];
  transactionIndex: bigint;
};

export async function encryptedBalance(c: PublicClient, eerc: Address, account: Address, tokenId: bigint): Promise<EncryptedBalance> {
  const [eGCT, nonce, amountPCTs, balancePCT, transactionIndex] = await c.readContract({
    address: eerc,
    abi: encryptedErcAbi,
    functionName: 'balanceOf',
    args: [account, tokenId],
  });
  return {
    c1: [eGCT.c1.x, eGCT.c1.y],
    c2: [eGCT.c2.x, eGCT.c2.y],
    nonce,
    amountPCTs: amountPCTs.map((a) => ({ pct: [...a.pct], index: a.index })),
    balancePCT: [...balancePCT],
    transactionIndex,
  };
}

/**
 * The holder's own view: decrypt the balance PCT and every pending amount PCT,
 * then check the sum against the ElGamal balance the contract keeps (the PCTs
 * are only hints; the ElGamal ciphertext is what the circuits spend).
 */
export function decryptBalance(k: Keypair, b: EncryptedBalance): bigint {
  let total = 0n;
  if (!isZero(b.balancePCT)) total += decryptPct(k, b.balancePCT)[0]!;
  for (const a of b.amountPCTs) if (!isZero(a.pct)) total += decryptPct(k, a.pct)[0]!;
  const empty = b.c1[0] === 0n && b.c1[1] === 0n && b.c2[0] === 0n && b.c2[1] === 0n;
  if (empty) {
    if (total !== 0n) throw Error('The private balance has amount hints but no encrypted balance.');
    return 0n;
  }
  const point = elgamalDecryptPoint(k, b.c1, b.c2);
  const expect = total === 0n ? ([0n, 1n] as const) : mulPointEscalar(Base8, total);
  if (point[0] !== expect[0] || point[1] !== expect[1]) throw Error('This key does not open this private balance (the encrypted balance does not match its hints).');
  return total;
}

export async function registeredKey(c: PublicClient, registrar: Address, account: Address): Promise<[bigint, bigint] | null> {
  const ok = await c.readContract({ address: registrar, abi: registrarAbi, functionName: 'isUserRegistered', args: [account] });
  if (!ok) return null;
  const pk = await c.readContract({ address: registrar, abi: registrarAbi, functionName: 'getUserPublicKey', args: [account] });
  return [pk[0], pk[1]];
}

export async function auditorKey(c: PublicClient, eerc: Address): Promise<{ address: Address; publicKey: [bigint, bigint] }> {
  const [address, pk] = await Promise.all([
    c.readContract({ address: eerc, abi: encryptedErcAbi, functionName: 'auditor' }),
    c.readContract({ address: eerc, abi: encryptedErcAbi, functionName: 'auditorPublicKey' }),
  ]);
  return { address, publicKey: [pk[0], pk[1]] };
}

/* ------------------------------------------------------------------ */
/* Proof inputs                                                         */
/* ------------------------------------------------------------------ */

export function registrationInput(k: Keypair, account: Address, chainId: number) {
  return {
    SenderPrivateKey: k.secret,
    SenderPublicKey: k.publicKey,
    SenderAddress: BigInt(account),
    ChainID: BigInt(chainId),
    RegistrationHash: registrationHash(k, account, chainId),
  };
}

/** Amount PCT for `deposit(amount, token, amountPCT)`: the depositor's own record of what came in. */
export function depositPct(k: Keypair, amount: bigint): Pct {
  return encryptPct([amount], k.publicKey).pct;
}

export function withdrawInput(k: Keypair, balance: bigint, b: EncryptedBalance, amount: bigint, auditor: readonly bigint[]) {
  if (amount <= 0n) throw Error('Move out at least 0.01 tUSDC.');
  if (amount > balance) throw Error(`Only ${fmtPrivate(balance)} tUSDC in your private balance.`);
  const next = encryptPct([balance - amount], k.publicKey);
  const audit = encryptPct([amount], auditor);
  return {
    input: {
      ValueToWithdraw: amount,
      SenderPrivateKey: k.secret,
      SenderPublicKey: k.publicKey,
      SenderBalance: balance,
      SenderBalanceC1: b.c1,
      SenderBalanceC2: b.c2,
      AuditorPublicKey: [auditor[0]!, auditor[1]!],
      AuditorPCT: audit.ciphertext,
      AuditorPCTAuthKey: audit.authKey,
      AuditorPCTNonce: audit.nonce,
      AuditorPCTRandom: audit.random,
    },
    balancePCT: next.pct,
  };
}

export function transferInput(k: Keypair, balance: bigint, b: EncryptedBalance, to: readonly bigint[], amount: bigint, auditor: readonly bigint[]) {
  if (amount <= 0n) throw Error('Send at least 0.01 tUSDC.');
  if (amount > balance) throw Error(`Only ${fmtPrivate(balance)} tUSDC in your private balance.`);
  const sender = elgamalEncrypt(k.publicKey, amount);
  const receiver = elgamalEncrypt(to, amount);
  const receiverPct = encryptPct([amount], to);
  const audit = encryptPct([amount], auditor);
  const next = encryptPct([balance - amount], k.publicKey);
  return {
    input: {
      ValueToTransfer: amount,
      SenderPrivateKey: k.secret,
      SenderPublicKey: k.publicKey,
      SenderBalance: balance,
      SenderBalanceC1: b.c1,
      SenderBalanceC2: b.c2,
      SenderVTTC1: sender.c1,
      SenderVTTC2: sender.c2,
      ReceiverPublicKey: [to[0]!, to[1]!],
      ReceiverVTTC1: receiver.c1,
      ReceiverVTTC2: receiver.c2,
      ReceiverVTTRandom: receiver.random,
      ReceiverPCT: receiverPct.ciphertext,
      ReceiverPCTAuthKey: receiverPct.authKey,
      ReceiverPCTNonce: receiverPct.nonce,
      ReceiverPCTRandom: receiverPct.random,
      AuditorPublicKey: [auditor[0]!, auditor[1]!],
      AuditorPCT: audit.ciphertext,
      AuditorPCTAuthKey: audit.authKey,
      AuditorPCTNonce: audit.nonce,
      AuditorPCTRandom: audit.random,
    },
    balancePCT: next.pct,
  };
}

/** snarkjs proof → the eERC `ProofPoints` layout (G2 coordinates swapped, as the Groth16 verifier expects). */
export function contractProof<N extends number>(proof: SnarkProof, publicSignals: string[]): ContractProof<N> {
  const n = (s: string | undefined) => BigInt(s ?? '0');
  return {
    proofPoints: {
      a: [n(proof.pi_a[0]), n(proof.pi_a[1])],
      b: [
        [n(proof.pi_b[0]?.[1]), n(proof.pi_b[0]?.[0])],
        [n(proof.pi_b[1]?.[1]), n(proof.pi_b[1]?.[0])],
      ],
      c: [n(proof.pi_c[0]), n(proof.pi_c[1])],
    },
    publicSignals: publicSignals.map(n) as ContractProof<N>['publicSignals'],
  };
}

/* ------------------------------------------------------------------ */
/* Kumi memos: which chat a private send belongs to                     */
/* ------------------------------------------------------------------ */

/**
 * The bytes a Kumi private send passes to eERC's `transfer(..., message)`; eERC emits them in `PrivateMessage`.
 * Public on purpose: the venue (KumiLobby or a KumiCrew vault), channel and call it belongs to, so the chat card can
 * be checked against the chain. Private: `senderPct`, the amount encrypted to the sender's own key, so the sender's
 * app can show "you sent 2.00" later (eERC itself only leaves the receiver and the auditor a readable copy).
 */
export type KumiMemo = { kind: 'tip' | 'send'; venue: Address; channel: bigint; ref: bigint; senderPct: bigint[] };
const MEMO_MAGIC = '0x4b554d49' as const; // "KUMI"
const MEMO_ABI = [
  { type: 'bytes4' }, { type: 'uint8' }, { type: 'address' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint256[7]' },
] as const;
export const NO_REF = (1n << 64n) - 1n;

export function encodeMemo(m: KumiMemo): Hex {
  if (m.senderPct.length !== 7) throw Error('senderPct has 7 words.');
  return encodeAbiParameters(MEMO_ABI, [MEMO_MAGIC, m.kind === 'tip' ? 1 : 2, m.venue, m.channel, m.ref, m.senderPct as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint]]);
}

export function decodeMemo(data: Hex): KumiMemo | null {
  try {
    const [magic, kind, venue, channel, ref, pct] = decodeAbiParameters(MEMO_ABI, data);
    if (magic.toLowerCase() !== MEMO_MAGIC || (kind !== 1 && kind !== 2)) return null;
    return { kind: kind === 1 ? 'tip' : 'send', venue, channel, ref, senderPct: [...pct] };
  } catch {
    return null;
  }
}

/** The text a member posts in the chat after a private send: the eERC transaction it points to. */
export const PRIVATE_PREFIX = 'kumi:private:';
export const privateChatText = (hash: Hex) => `${PRIVATE_PREFIX}${hash}`;
export function privateTxOf(text: string): Hex | null {
  const m = /^kumi:private:(0x[0-9a-fA-F]{64})$/.exec(text.trim());
  return m ? (m[1]!.toLowerCase() as Hex) : null;
}

/* ------------------------------------------------------------------ */
/* Reading one private send back from the chain                         */
/* ------------------------------------------------------------------ */

export type PrivateSend = {
  hash: Hex;
  from: Address;
  to: Address;
  tokenId: bigint;
  memo: KumiMemo | null;
  block: bigint;
  /** the three readable copies of the amount; everything else on chain is ElGamal ciphertext */
  receiverPct: bigint[];
  auditorPct: bigint[];
};

/**
 * Loads an eERC private transfer by transaction hash and checks it is what a chat card claims: a successful
 * `transfer` on Kumi's eERC, sent by `author`, with a `PrivateTransfer` event. Throws a readable reason otherwise.
 */
export async function readPrivateSend(c: PublicClient, eerc: Address, hash: Hex, author?: Address): Promise<PrivateSend> {
  const [tx, receipt] = await Promise.all([c.getTransaction({ hash }), c.getTransactionReceipt({ hash })]);
  if (!tx.to || tx.to.toLowerCase() !== eerc.toLowerCase()) throw Error('Not a Kumi private send (another contract).');
  if (receipt.status !== 'success') throw Error('That private send reverted.');
  if (author && tx.from.toLowerCase() !== author.toLowerCase()) throw Error('Posted by someone other than the sender.');
  const call = decodeFunctionData({ abi: encryptedErcAbi, data: tx.input });
  if (call.functionName !== 'transfer') throw Error('Not a private send.');
  const args = call.args as readonly unknown[];
  const to = args[0] as Address;
  const tokenId = args[1] as bigint;
  const proof = args[2] as { publicSignals: readonly bigint[] };
  const memo = args.length > 4 ? decodeMemo(args[4] as Hex) : null;
  let auditorPct: bigint[] | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== eerc.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: encryptedErcAbi, data: log.data, topics: log.topics }) as { eventName: string; args: Record<string, unknown> };
      if (ev.eventName === 'PrivateTransfer') auditorPct = [...(ev.args.auditorPCT as readonly bigint[])];
    } catch { /* not an eERC event */ }
  }
  if (!auditorPct) throw Error('No PrivateTransfer event in that transaction.');
  return {
    hash, from: tx.from, to, tokenId, memo, block: receipt.blockNumber,
    receiverPct: proof.publicSignals.slice(16, 23).map(BigInt),
    auditorPct,
  };
}

/**
 * The amount of a private send as `viewer` can see it: the receiver opens the receiver copy, the sender opens the
 * memo copy, the auditor opens the auditor copy. Anyone else gets null ("amount hidden").
 */
export function privateAmountFor(s: PrivateSend, viewer: Address | undefined, key: Keypair | undefined, auditor?: Keypair): bigint | null {
  const tryOpen = (k: Keypair, pct: readonly bigint[]) => { try { return decryptPct(k, pct)[0] ?? null; } catch { return null; } };
  if (auditor) { const a = tryOpen(auditor, s.auditorPct); if (a !== null) return a; }
  if (!viewer || !key) return null;
  const v = viewer.toLowerCase();
  if (v === s.to.toLowerCase()) return tryOpen(key, s.receiverPct);
  if (v === s.from.toLowerCase() && s.memo) return tryOpen(key, s.memo.senderPct);
  return null;
}

/** Everything a client needs to send privately, read in one go. */
export async function eercState(c: PublicClient, eerc: Address, registrar: Address, token: Address, me: Address) {
  const [id, key, auditor] = await Promise.all([
    c.readContract({ address: eerc, abi: encryptedErcAbi, functionName: 'tokenIds', args: [token] }),
    registeredKey(c, registrar, me),
    auditorKey(c, eerc),
  ]);
  const balance = id === 0n ? null : await encryptedBalance(c, eerc, me, id);
  return { tokenId: id, registered: key, auditor, balance };
}

/** A stable short fingerprint of a ciphertext, for showing what the public sees. */
export function ciphertextFingerprint(b: EncryptedBalance): string {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256[4]' }], [[b.c1[0], b.c1[1], b.c2[0], b.c2[1]]]));
  return `${h.slice(2, 10)}…${h.slice(-6)}`;
}

/** The memo for a private send, with the amount encrypted to the sender's own key. */
export function buildMemo(k: Keypair, kind: KumiMemo['kind'], venue: Address, channel: bigint, ref: bigint, amount: bigint): Hex {
  return encodeMemo({ kind, venue, channel, ref, senderPct: encryptPct([amount], k.publicKey).pct });
}
