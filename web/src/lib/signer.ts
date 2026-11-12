import { useSyncExternalStore } from 'react';
import { createWalletClient, custom, http, type Abi, type Address, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, FUJI_RPC, DEPLOYMENT } from '@kumi-avax/sdk';
import { pub, readable } from './chain';

/**
 * Two ways to sign:
 *  - A browser wallet (Core, MetaMask…) through EIP-1193, switched to Fuji. This is the production path.
 *  - The QA signer: only in builds made with VITE_QA=1 (`pnpm build:qa`), and only when the test harness injects
 *    `window.__KUMI_QA__ = { keys: { mika, bo, ren } }` with Fuji test keys. Production builds drop this code, and
 *    no key is ever in the bundle.
 */
export type Who = { address: Address; label: string; kind: 'wallet' | 'qa' };
type QaWindow = Window & { __KUMI_QA__?: { keys: Record<string, Hex> }; ethereum?: any };
export const QA = import.meta.env.VITE_QA === '1';

let current: Who | null = null;
let client: WalletClient | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function useWho() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => current);
}

export function nameOf(a: string | undefined | null): string {
  if (!a) return '';
  const n = (DEPLOYMENT.names as Record<string, string>)[a.toLowerCase()];
  return n ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function qaMembers(): string[] {
  if (!QA) return [];
  return Object.keys((window as QaWindow).__KUMI_QA__?.keys ?? {});
}

export function selectQa(label: string) {
  if (!QA) return;
  const key = (window as QaWindow).__KUMI_QA__?.keys[label];
  if (!key) throw Error(`QA signer "${label}" was not injected`);
  const account = privateKeyToAccount(key);
  client = createWalletClient({ account, chain: fuji, transport: http(FUJI_RPC) });
  current = { address: account.address, label, kind: 'qa' };
  try { sessionStorage.setItem('kumi:qa', label); } catch { /* private mode */ }
  emit();
}

export function restoreQa() {
  if (!QA) return;
  let l: string | null = null;
  try { l = sessionStorage.getItem('kumi:qa'); } catch { /* private mode */ }
  const ms = qaMembers();
  if (ms.length) selectQa(l && ms.includes(l) ? l : ms[0]!);
}

export async function connectWallet() {
  const eth = (window as QaWindow).ethereum;
  if (!eth) throw Error('No browser wallet found. Install Core or MetaMask, then reload.');
  const [address] = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] });
  } catch (e: any) {
    if (e?.code === 4902) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xa869', chainName: 'Avalanche Fuji C-Chain', nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 }, rpcUrls: [FUJI_RPC], blockExplorerUrls: ['https://testnet.snowtrace.io'] }] });
    } else throw e;
  }
  client = createWalletClient({ account: address!, chain: fuji, transport: custom(eth) });
  current = { address: address!, label: nameOf(address!), kind: 'wallet' };
  emit();
}

export function disconnect() { current = null; client = null; emit(); }

/** Sends a contract call from the current signer, pads the gas estimate, waits for the receipt. */
export async function write(address: Address, abi: Abi, functionName: string, args: unknown[] = []): Promise<Hex> {
  if (!client || !current) throw Error('Connect a wallet first.');
  try {
    const { request } = await pub.simulateContract({ account: current.address, address, abi, functionName, args } as any);
    const gas = await pub.estimateContractGas({ account: current.address, address, abi, functionName, args } as any);
    const hash = await client.writeContract({ ...(request as any), account: client.account ?? current.address, chain: fuji, gas: gas * 13n / 10n });
    const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 90_000 });
    if (r.status !== 'success') throw Error(`Transaction reverted on Fuji: ${hash}`);
    window.dispatchEvent(new CustomEvent('kumi:tx', { detail: { hash, functionName } }));
    return hash;
  } catch (e) {
    throw Error(readable(e));
  }
}
