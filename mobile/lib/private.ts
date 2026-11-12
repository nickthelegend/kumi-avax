/**
 * Kumi's private balance on the phone: Ava Labs' EncryptedERC (converter over tUSDC) on Fuji.
 * The eERC key comes from one signature by this phone's wallet over a fixed message, so it is never stored; the
 * proofs are made on the device (lib/prover). Every action is a Fuji transaction signed here (lib/chain `send`).
 */
import type { Address, Hex } from 'viem';
import { DEPLOYMENT, crewAbi, fuji, lobbyAbi, usdcAbi } from '@kumi-avax/sdk';
import {
  NO_REF, buildMemo, ciphertextFingerprint, contractProof, decryptBalance, depositPct, eercState, encryptedErcAbi, keyMessage,
  keypairFromSignature, privateAmountFor, privateChatText, readPrivateSend, registeredKey, registrarAbi, registrationInput,
  transferInput, withdrawInput, type Keypair, type PrivateSend,
} from '@kumi-avax/sdk/eerc';
import { LOBBY, USDC, pub, send, type Sent } from './chain';
import { signer } from './wallet';
import { prove, PROVER_WHERE } from './prover';

export const EERC = (DEPLOYMENT.eerc?.encryptedERC ?? null) as Address | null;
export const REGISTRAR = (DEPLOYMENT.eerc?.registrar ?? null) as Address | null;
export const AUDITOR = (DEPLOYMENT.eerc?.auditor ?? null) as Address | null;
const need = () => { if (!EERC || !REGISTRAR) throw Error('Setup required: no eERC in deployments/fuji.json.'); return { eerc: EERC, registrar: REGISTRAR }; };
type Step = (s: string) => void;

let key: { for: string; k: Keypair } | null = null;
/** This wallet's eERC key: one local signature over keyMessage (no prompt: the key is this phone's own wallet). */
export async function privateKey(): Promise<Keypair> {
  const a = signer();
  if (key?.for === a.address) return key.k;
  const k = keypairFromSignature(await a.signMessage({ message: keyMessage(a.address, fuji.id) }));
  key = { for: a.address, k };
  return k;
}

export async function readPrivate(me: Address) {
  const { eerc, registrar } = need();
  const s = await eercState(pub as any, eerc, registrar, USDC, me);
  const k = await privateKey();
  const empty = !s.balance || (s.balance.c1[0] === 0n && s.balance.c1[1] === 0n);
  return {
    registered: !!s.registered,
    tokenId: s.tokenId,
    balance: s.registered && s.balance && s.tokenId !== 0n ? decryptBalance(k, s.balance) : 0n,
    fingerprint: s.balance && !empty ? ciphertextFingerprint(s.balance) : null,
    auditor: s.auditor.address,
  };
}
export type PrivateState = Awaited<ReturnType<typeof readPrivate>>;

export async function openPrivate(step: Step): Promise<Sent> {
  const { registrar } = need();
  const me = signer().address;
  const k = await privateKey();
  step(`Proving your eERC key ${PROVER_WHERE}`);
  const { proof, publicSignals } = await prove('registration', registrationInput(k, me, fuji.id));
  step('Registering it on Fuji');
  return send(registrar, registrarAbi as any, 'register', [contractProof(proof, publicSignals)], 'Open private balance');
}

/** Move `units` (cents) of tUSDC in. The amount moving in is public, like any token transfer. */
export async function moveIn(units: bigint, step: Step): Promise<Sent[]> {
  const { eerc } = need();
  const me = signer().address;
  const k = await privateKey();
  const raw = units * 10_000n;
  const out: Sent[] = [];
  const allowance = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, eerc] });
  if (allowance < raw) { step('Approving tUSDC for the eERC'); out.push(await send(USDC, usdcAbi as any, 'approve', [eerc, raw], 'Approve tUSDC (eERC)')); }
  step('Moving it into your private balance');
  out.push(await send(eerc, encryptedErcAbi as any, 'deposit', [raw, USDC, depositPct(k, units)], `Move ${fmt(units)} in`));
  return out;
}

export async function moveOut(units: bigint, step: Step): Promise<Sent> {
  const { eerc } = need();
  const me = signer().address;
  const k = await privateKey();
  const s = await eercState(pub as any, eerc, REGISTRAR!, USDC, me);
  if (!s.balance) throw Error('Nothing in your private balance yet.');
  const balance = decryptBalance(k, s.balance);
  const w = withdrawInput(k, balance, s.balance, units, s.auditor.publicKey);
  step(`Proving the move out ${PROVER_WHERE}`);
  const { proof, publicSignals } = await prove('withdraw', w.input);
  step('Sending it on Fuji');
  return send(eerc, encryptedErcAbi as any, 'withdraw', [s.tokenId, contractProof(proof, publicSignals), w.balancePCT], `Move ${fmt(units)} out`);
}

export type Where = { kind: 'tip' | 'send'; channel?: number; crew?: Address; ref?: number };

/**
 * A private send to `to`, then the chat card that points to it. The amount never appears on Fuji: the proof shows
 * the sender had enough and both balances moved by the same hidden amount.
 */
export async function sendPrivately(to: Address, units: bigint, where: Where, step: Step): Promise<Sent[]> {
  const { eerc, registrar } = need();
  const me = signer().address;
  if (to.toLowerCase() === me.toLowerCase()) throw Error('That is you.');
  const k = await privateKey();
  const toKey = await registeredKey(pub as any, registrar, to);
  if (!toKey) throw Error('They have not opened a private balance yet, so there is nowhere private to send to.');
  const s = await eercState(pub as any, eerc, registrar, USDC, me);
  if (!s.registered || !s.balance) throw Error('Open your private balance and move some tUSDC in first (Wallet tab).');
  const balance = decryptBalance(k, s.balance);
  const t = transferInput(k, balance, s.balance, toKey, units, s.auditor.publicKey);
  step(`Proving the private send ${PROVER_WHERE}`);
  const { proof, publicSignals } = await prove('transfer', t.input);
  const venue = where.crew ?? LOBBY;
  const memo = buildMemo(k, where.kind, venue, BigInt(where.channel ?? 0), where.ref === undefined ? NO_REF : BigInt(where.ref), units);
  step('Sending it on Fuji');
  const tx = await send(eerc, encryptedErcAbi as any, 'transfer', [to, s.tokenId, contractProof(proof, publicSignals), t.balancePCT, memo], where.kind === 'tip' ? 'Private tip' : 'Private send');
  step('Posting the card in the chat');
  const post = where.crew
    ? await send(where.crew, crewAbi as any, 'say', [privateChatText(tx.hash as Hex)], 'Private send card')
    : await send(LOBBY, lobbyAbi as any, 'say', [BigInt(where.channel ?? 0), privateChatText(tx.hash as Hex)], 'Private tip card');
  return [tx, post];
}

const cache = new Map<string, Promise<PrivateSend>>();
/** A private send as the chat card shows it: checked against the chain, plus the amount if this phone may see it. */
export async function readCard(hash: Hex, author: Address, me: Address | null) {
  const { eerc } = need();
  let p = cache.get(hash);
  if (!p) { p = readPrivateSend(pub as any, eerc, hash, author); cache.set(hash, p); p.catch(() => cache.delete(hash)); }
  const s = await p;
  const amount = me ? privateAmountFor(s, me, await privateKey()) : null;
  return { send: s, amount };
}

export const fmt = (units: bigint) => `${(units / 100n).toLocaleString('en-US')}.${(units % 100n).toString().padStart(2, '0')}`;
