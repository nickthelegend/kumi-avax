/**
 * Kumi's private balance from Node: deploy Ava Labs' EncryptedERC in converter mode over TestUSDC (from the pinned
 * submodule's Foundry build), then register, shield, send privately with a Kumi memo, and move out, with real
 * Groth16 proofs (snarkjs and the production zkeys shipped in contracts/lib/EncryptedERC/circom/build).
 *
 * Used by the Anvil end-to-end test (local-e2e.ts) and the Fuji script (fuji.ts). Nothing here prints a key:
 * members' eERC keys come from a wallet signature over keyMessage(), exactly as in the apps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createWalletClient, encodeFunctionData, http, type Abi, type Address, type Chain, type Hex, type PrivateKeyAccount, type PublicClient, type Transport } from 'viem';
import {
  auditorKey, buildMemo, contractProof, decryptBalance, depositPct, encryptedBalance, encryptedErcAbi, keyMessage, keypairFromSignature,
  registeredKey, registrarAbi, registrationInput, transferInput, withdrawInput, type Circuit, type Keypair, type KumiMemo, type Prover,
} from '@kumi-avax/sdk/eerc';
import { usdcAbi } from '@kumi-avax/sdk';
import { ROOT } from '../fuji/env.ts';

const require = createRequire(import.meta.url);
const BUILD = join(ROOT, 'contracts/lib/EncryptedERC/circom/build');
// Upstream names: registration and withdraw ship circuit_final.zkey, transfer ships transfer.zkey.
export const CIRCUIT_FILES: Record<Circuit, { wasm: string; zkey: string }> = {
  registration: { wasm: join(BUILD, 'registration/registration.wasm'), zkey: join(BUILD, 'registration/circuit_final.zkey') },
  transfer: { wasm: join(BUILD, 'transfer/transfer.wasm'), zkey: join(BUILD, 'transfer/transfer.zkey') },
  withdraw: { wasm: join(BUILD, 'withdraw/withdraw.wasm'), zkey: join(BUILD, 'withdraw/circuit_final.zkey') },
};

const strings = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(strings) : v);

export const nodeProver: Prover = async (circuit, input) => {
  const snarkjs = require('snarkjs');
  const flat = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, strings(v)]));
  const { wasm, zkey } = CIRCUIT_FILES[circuit];
  const t0 = Date.now();
  const out = await snarkjs.groth16.fullProve(flat, wasm, zkey);
  console.log(`     proof ${circuit} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return out;
};

export async function closeProver() {
  const curve = (globalThis as { curve_bn128?: { terminate: () => Promise<void> } }).curve_bn128;
  if (curve) await curve.terminate();
}

function artifact(name: string) {
  const j = JSON.parse(readFileSync(join(ROOT, 'contracts/out-eerc', `${name}.sol`, `${name}.json`), 'utf8'));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex, links: j.bytecode.linkReferences as Record<string, Record<string, { start: number; length: number }[]>> };
}

export type Sent = { label: string; from: Address; to: Address | null; hash: Hex; status: string; block: number; gasUsed: number; confirmMs: number; at: string };
export type Ctx = { pub: PublicClient; chain: Chain; transport: () => Transport; log: Sent[]; onSent?: (s: Sent) => void };

const walletOf = (ctx: Ctx, who: PrivateKeyAccount) => createWalletClient({ account: who, chain: ctx.chain, transport: ctx.transport() });

async function finish(ctx: Ctx, label: string, from: Address, to: Address | null, hash: Hex, t0: number) {
  const r = await ctx.pub.waitForTransactionReceipt({ hash, pollingInterval: 250, timeout: 120_000 });
  const sent: Sent = { label, from, to, hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), confirmMs: Date.now() - t0, at: new Date().toISOString() };
  console.log(`${r.status === 'success' ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} ${hash} ${sent.confirmMs}ms gas ${r.gasUsed}`);
  if (r.status !== 'success') throw Error(`${label} reverted: ${hash}`);
  ctx.log.push(sent);
  ctx.onSent?.(sent);
  return { sent, receipt: r };
}

export async function send(ctx: Ctx, who: PrivateKeyAccount, to: Address, abi: Abi, functionName: string, args: readonly unknown[], label: string): Promise<Sent> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  await ctx.pub.call({ account: who.address, to, data }); // refuse before broadcasting, with the contract's reason
  const gas = await ctx.pub.estimateGas({ account: who.address, to, data });
  const t0 = Date.now();
  const hash = await walletOf(ctx, who).sendTransaction({ to, data, gas: gas * 13n / 10n } as never);
  return (await finish(ctx, label, who.address, to, hash, t0)).sent;
}

async function deploy(ctx: Ctx, who: PrivateKeyAccount, name: string, args: unknown[] = [], libs: Record<string, Address> = {}) {
  const a = artifact(name);
  let code = a.bytecode;
  for (const [, byName] of Object.entries(a.links ?? {})) {
    for (const [lib, spots] of Object.entries(byName)) {
      const addr = libs[lib];
      if (!addr) throw Error(`missing library ${lib}`);
      for (const s of spots) code = `${code.slice(0, 2 + s.start * 2)}${addr.slice(2).toLowerCase()}${code.slice(2 + (s.start + s.length) * 2)}` as Hex;
    }
  }
  const t0 = Date.now();
  const hash = await walletOf(ctx, who).deployContract({ abi: a.abi, bytecode: code, args } as never);
  const { receipt } = await finish(ctx, `deploy_${name}`, who.address, null, hash, t0);
  if (!receipt.contractAddress) throw Error(`deploy ${name}: no address`);
  return receipt.contractAddress;
}

export type Vault = {
  encryptedERC: Address;
  registrar: Address;
  babyJubJub: Address;
  verifiers: { registration: Address; mint: Address; withdraw: Address; transfer: Address; burn: Address };
};

/** Same order and parameters as upstream scripts/deploy-converter.ts with isProd = true and decimals 2. */
export async function deployVault(ctx: Ctx, owner: PrivateKeyAccount): Promise<Vault> {
  const registration = await deploy(ctx, owner, 'RegistrationVerifier');
  const mint = await deploy(ctx, owner, 'MintVerifier');
  const withdraw = await deploy(ctx, owner, 'WithdrawVerifier');
  const transfer = await deploy(ctx, owner, 'TransferVerifier');
  const burn = await deploy(ctx, owner, 'BurnVerifier');
  const babyJubJub = await deploy(ctx, owner, 'BabyJubJub');
  const registrar = await deploy(ctx, owner, 'Registrar', [registration]);
  const encryptedERC = await deploy(ctx, owner, 'EncryptedERC', [
    { registrar, isConverter: true, name: '', symbol: '', decimals: 2, mintVerifier: mint, withdrawVerifier: withdraw, transferVerifier: transfer, burnVerifier: burn },
  ], { BabyJubJub: babyJubJub });
  return { encryptedERC, registrar, babyJubJub, verifiers: { registration, mint, withdraw, transfer, burn } };
}

export async function openKey(who: PrivateKeyAccount, chainId: number): Promise<Keypair> {
  return keypairFromSignature(await who.signMessage({ message: keyMessage(who.address, chainId) }));
}

export async function register(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, prover: Prover, label: string) {
  if (await registeredKey(ctx.pub, v.registrar, who.address)) return null;
  const { proof, publicSignals } = await prover('registration', registrationInput(k, who.address, ctx.chain.id));
  return send(ctx, who, v.registrar, registrarAbi as Abi, 'register', [contractProof(proof, publicSignals)], label);
}

export async function tokenId(ctx: Ctx, v: Vault, token: Address): Promise<bigint> {
  return ctx.pub.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: 'tokenIds', args: [token] });
}

export async function balanceOf(ctx: Ctx, v: Vault, who: Address, k: Keypair, token: Address) {
  const id = await tokenId(ctx, v, token);
  const b = await encryptedBalance(ctx.pub, v.encryptedERC, who, id);
  return { id, b, balance: id === 0n ? 0n : decryptBalance(k, b) };
}

/** Shield `units` (private units, 1e2) of tUSDC: approve, then eERC deposit with the depositor's amount PCT. */
export async function shield(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, token: Address, units: bigint, label: string) {
  const raw = units * 10_000n;
  const allowance = await ctx.pub.readContract({ address: token, abi: usdcAbi, functionName: 'allowance', args: [who.address, v.encryptedERC] });
  if (allowance < raw) await send(ctx, who, token, usdcAbi as Abi, 'approve', [v.encryptedERC, raw], `${label}_approve`);
  return send(ctx, who, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [raw, token, depositPct(k, units)], label);
}

export type MemoTarget = { kind: KumiMemo['kind']; venue: Address; channel: bigint; ref: bigint };

/** A private send with a Kumi memo (which chat and call it belongs to, plus the sender's own encrypted copy). */
export async function sendPrivately(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, token: Address, to: Address, units: bigint, memo: MemoTarget, prover: Prover, label: string) {
  const { id, b, balance } = await balanceOf(ctx, v, who.address, k, token);
  const toKey = await registeredKey(ctx.pub, v.registrar, to);
  if (!toKey) throw Error(`${to} has not opened a private balance yet`);
  const auditor = await auditorKey(ctx.pub, v.encryptedERC);
  const t = transferInput(k, balance, b, toKey, units, auditor.publicKey);
  const { proof, publicSignals } = await prover('transfer', t.input);
  const message = buildMemo(k, memo.kind, memo.venue, memo.channel, memo.ref, units);
  return send(ctx, who, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', [to, id, contractProof(proof, publicSignals), t.balancePCT, message], label);
}

export async function unshield(ctx: Ctx, v: Vault, who: PrivateKeyAccount, k: Keypair, token: Address, units: bigint, prover: Prover, label: string) {
  const { id, b, balance } = await balanceOf(ctx, v, who.address, k, token);
  const auditor = await auditorKey(ctx.pub, v.encryptedERC);
  const w = withdrawInput(k, balance, b, units, auditor.publicKey);
  const { proof, publicSignals } = await prover('withdraw', w.input);
  return send(ctx, who, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [id, contractProof(proof, publicSignals), w.balancePCT], label);
}
