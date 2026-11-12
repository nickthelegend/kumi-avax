/**
 * Kumi's private balance in the web app: Ava Labs' EncryptedERC (converter over tUSDC) on Fuji, the same contract
 * and SDK code as the phone. The eERC key comes from one wallet signature over a fixed message (asked once per
 * session); proofs are made in this browser with snarkjs and Ava Labs' production circuit files (/eerc).
 */
import type { Abi, Address, Hex } from 'viem';
import { DEPLOYMENT, crewAbi, fuji, lobbyAbi, usdcAbi } from '@kumi-avax/sdk';
import {
  NO_REF, buildMemo, ciphertextFingerprint, contractProof, decryptBalance, depositPct, eercState, encryptedErcAbi, keyMessage,
  keypairFromSignature, privateAmountFor, privateChatText, readPrivateSend, registeredKey, registrarAbi, registrationInput,
  transferInput, withdrawInput, type Circuit, type Keypair, type PrivateSend,
} from '@kumi-avax/sdk/eerc';
import { USDC, pub } from './chain';
import { LOBBY } from './lobby';
import { signText, write } from './signer';

export const EERC = (DEPLOYMENT.eerc?.encryptedERC ?? null) as Address | null;
export const REGISTRAR = (DEPLOYMENT.eerc?.registrar ?? null) as Address | null;
const need = () => { if (!EERC || !REGISTRAR) throw Error('Setup required: no eERC in deployments/fuji.json.'); return { eerc: EERC, registrar: REGISTRAR }; };
type Step = (s: string) => void;

// ---------------------------------------------------------------- keys (memory only, per address)
const keys = new Map<string, Keypair>();
const subs = new Set<() => void>();
export const keyOpen = (a?: Address) => !!a && keys.has(a.toLowerCase());
export const onKeys = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export async function privateKey(me: Address): Promise<Keypair> {
  const hit = keys.get(me.toLowerCase());
  if (hit) return hit;
  const k = keypairFromSignature(await signText(keyMessage(me, fuji.id)));
  keys.set(me.toLowerCase(), k);
  subs.forEach(f => f());
  return k;
}

// ---------------------------------------------------------------- prover (snarkjs in this page)
const strings = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(strings) : v);
let loading: Promise<void> | null = null;
function snark(): Promise<any> {
  const w = window as any;
  if (w.snarkjs) return Promise.resolve(w.snarkjs);
  loading ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/eerc/snarkjs-0.7.5.min.js';
    s.onload = () => ok();
    s.onerror = () => { loading = null; fail(Error('Could not load the zk prover from /eerc. Setup required: node scripts/copy-eerc-assets.mjs before building.')); };
    document.head.appendChild(s);
  });
  return loading.then(() => w.snarkjs);
}
async function prove(circuit: Circuit, input: Record<string, unknown>) {
  const s = await snark();
  const flat = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, strings(v)]));
  return s.groth16.fullProve(flat, `/eerc/${circuit}.wasm`, `/eerc/${circuit}.zkey`) as Promise<{ proof: any; publicSignals: string[] }>;
}

// ---------------------------------------------------------------- reads
/** Public view (no key): registered or not, and the ciphertext fingerprint. With an opened key, the balance too. */
export async function readPrivate(me: Address) {
  const { eerc, registrar } = need();
  const s = await eercState(pub as any, eerc, registrar, USDC, me);
  const k = keys.get(me.toLowerCase());
  const empty = !s.balance || (s.balance.c1[0] === 0n && s.balance.c1[1] === 0n);
  return {
    registered: !!s.registered,
    balance: k && s.registered && s.balance && s.tokenId !== 0n ? decryptBalance(k, s.balance) : null,
    fingerprint: s.balance && !empty ? ciphertextFingerprint(s.balance) : null,
  };
}

const cache = new Map<string, Promise<PrivateSend>>();
export async function readCard(hash: Hex, author: Address, me?: Address) {
  const { eerc } = need();
  let p = cache.get(hash);
  if (!p) { p = readPrivateSend(pub as any, eerc, hash, author); cache.set(hash, p); p.catch(() => cache.delete(hash)); }
  const s = await p;
  const k = me ? keys.get(me.toLowerCase()) : undefined;
  return { send: s, amount: me && k ? privateAmountFor(s, me, k) : null };
}

// ---------------------------------------------------------------- actions
export async function openPrivate(me: Address, step: Step) {
  const { registrar } = need();
  const k = await privateKey(me);
  step('Proving your eERC key in this browser');
  const { proof, publicSignals } = await prove('registration', registrationInput(k, me, fuji.id));
  step('Registering it on Fuji');
  return write(registrar, registrarAbi as Abi, 'register', [contractProof(proof, publicSignals)]);
}

export async function moveIn(me: Address, units: bigint, step: Step) {
  const { eerc } = need();
  const k = await privateKey(me);
  const raw = units * 10_000n;
  const allowance = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, eerc] });
  if (allowance < raw) { step('Approving tUSDC for the eERC'); await write(USDC, usdcAbi as Abi, 'approve', [eerc, raw]); }
  step('Moving it into your private balance');
  return write(eerc, encryptedErcAbi as Abi, 'deposit', [raw, USDC, depositPct(k, units)]);
}

export async function moveOut(me: Address, units: bigint, step: Step) {
  const { eerc, registrar } = need();
  const k = await privateKey(me);
  const s = await eercState(pub as any, eerc, registrar, USDC, me);
  if (!s.balance) throw Error('Nothing in your private balance yet.');
  const w = withdrawInput(k, decryptBalance(k, s.balance), s.balance, units, s.auditor.publicKey);
  step('Proving the move out in this browser');
  const { proof, publicSignals } = await prove('withdraw', w.input);
  step('Sending it on Fuji');
  return write(eerc, encryptedErcAbi as Abi, 'withdraw', [s.tokenId, contractProof(proof, publicSignals), w.balancePCT]);
}

export type Where = { kind: 'tip' | 'send'; channel?: number; crew?: Address; ref?: number };
export async function sendPrivately(me: Address, to: Address, units: bigint, where: Where, step: Step) {
  const { eerc, registrar } = need();
  if (to.toLowerCase() === me.toLowerCase()) throw Error('That is you.');
  const k = await privateKey(me);
  const toKey = await registeredKey(pub as any, registrar, to);
  if (!toKey) throw Error('They have not opened a private balance yet, so there is nowhere private to send to.');
  const s = await eercState(pub as any, eerc, registrar, USDC, me);
  if (!s.registered || !s.balance) throw Error('Open your private balance and move some tUSDC in first.');
  const t = transferInput(k, decryptBalance(k, s.balance), s.balance, toKey, units, s.auditor.publicKey);
  step('Proving the private send in this browser');
  const { proof, publicSignals } = await prove('transfer', t.input);
  const memo = buildMemo(k, where.kind, where.crew ?? LOBBY, BigInt(where.channel ?? 0), where.ref === undefined ? NO_REF : BigInt(where.ref), units);
  step('Sending it on Fuji');
  const tx = await write(eerc, encryptedErcAbi as Abi, 'transfer', [to, s.tokenId, contractProof(proof, publicSignals), t.balancePCT, memo]);
  step('Posting the card in the chat');
  const post = where.crew
    ? await write(where.crew, crewAbi as Abi, 'say', [privateChatText(tx)])
    : await write(LOBBY, lobbyAbi as Abi, 'say', [BigInt(where.channel ?? 0), privateChatText(tx)]);
  return [tx, post];
}

export const fmt = (units: bigint) => `${(units / 100n).toLocaleString('en-US')}.${(units % 100n).toString().padStart(2, '0')}`;
