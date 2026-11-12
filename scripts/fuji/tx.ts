/** Sends transactions on Fuji and records every one (label, hash, block, gas, timing) in deployments/fuji.json. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, type Abi, type Account, type Hex } from 'viem';
import { client, fuji, FUJI_RPC, fujiTransport } from '@kumi-avax/sdk';
import { ROOT } from './env.ts';

export const DEPLOYMENT = join(ROOT, 'deployments/fuji.json');
export const pub = client();

export type Rec = { label: string; from: string; to: string | null; hash: string; status: string; block: number; gasUsed: number; confirmMs: number; at: string };

export function load(): any {
  return existsSync(DEPLOYMENT) ? JSON.parse(readFileSync(DEPLOYMENT, 'utf8')) : {
    network: { name: 'Avalanche Fuji C-Chain', chainId: 43113, rpc: FUJI_RPC, explorer: 'https://testnet.snowtrace.io' },
    contracts: {}, txs: [],
  };
}
export function save(d: any) { writeFileSync(DEPLOYMENT, JSON.stringify(d, null, 2) + '\n'); }

export function record(r: Rec, section = 'txs') {
  const d = load();
  (d[section] ??= []).push(r);
  save(d);
}

export function wallet(acct: Account) { return createWalletClient({ account: acct, chain: fuji, transport: fujiTransport() }); }

async function finish(label: string, from: string, to: string | null, hash: Hex, t0: number, section: string) {
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 250, timeout: 120_000 });
  const rec: Rec = { label, from, to, hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), confirmMs: Date.now() - t0, at: new Date().toISOString() };
  record(rec, section);
  console.log(`${r.status === 'success' ? 'ok ' : 'ERR'} ${label} ${hash} block ${r.blockNumber} gas ${r.gasUsed} ${rec.confirmMs}ms`);
  if (r.status !== 'success') throw Error(`${label} reverted: ${hash}`);
  return r;
}

export async function send(acct: Account, label: string, address: `0x${string}`, abi: Abi, functionName: string, args: unknown[] = [], section = 'txs', value?: bigint) {
  const w = wallet(acct);
  const { request } = await pub.simulateContract({ account: acct, address, abi, functionName, args, value } as any);
  // Estimates on Fuji can land a few hundred gas short of the cold-storage path; pad them by 30%.
  const est = await pub.estimateContractGas({ account: acct, address, abi, functionName, args, value } as any);
  const t0 = Date.now();
  const hash = await w.writeContract({ ...(request as any), gas: est * 13n / 10n });
  return finish(label, acct.address, address, hash, t0, section);
}

export async function deploy(acct: Account, label: string, abi: Abi, bytecode: Hex, args: unknown[] = []) {
  const w = wallet(acct);
  const t0 = Date.now();
  const hash = await w.deployContract({ abi, bytecode, args } as any);
  const r = await finish(label, acct.address, null, hash, t0, 'txs');
  return r.contractAddress!;
}

export async function transfer(acct: Account, label: string, to: `0x${string}`, value: bigint) {
  const w = wallet(acct);
  const t0 = Date.now();
  const hash = await w.sendTransaction({ to, value });
  return finish(label, acct.address, to, hash, t0, 'txs');
}

export function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(join(ROOT, 'contracts/out', file, `${name}.json`), 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
}
