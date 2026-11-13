import { defineChain, createPublicClient, http, fallback } from 'viem';

export const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
/** Second public Fuji RPC (PublicNode), used when the Avalanche one rate-limits. */
export const FUJI_RPC_2 = 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
/** A rate-limited Avalanche RPC answers 429 with `Retry-After: 800+` seconds, and viem waits that long before its retry,
 *  so every read hung for minutes instead of moving on to the second RPC. The header is dropped here, the first RPC is
 *  not retried (a failure goes straight to PublicNode), and PublicNode keeps short exponential retries. */
const noRetryAfter = (async (input: any, init?: any) => {
  const r = await fetch(input, init);
  if (!r.headers.has('retry-after')) return r;
  const headers = new Headers(r.headers);
  headers.delete('retry-after');
  return new Response(await r.text(), { status: r.status, statusText: r.statusText, headers });
}) as typeof fetch;
export const fujiTransport = () => fallback([
  http(FUJI_RPC, { retryCount: 0, timeout: 10_000, fetchFn: noRetryAfter }),
  http(FUJI_RPC_2, { retryCount: 2, timeout: 15_000, fetchFn: noRetryAfter }),
], { retryCount: 1 });
export const SNOWTRACE = 'https://testnet.snowtrace.io';

export const fuji = defineChain({
  id: 43113,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [FUJI_RPC, FUJI_RPC_2] } },
  blockExplorers: { default: { name: 'Snowtrace', url: SNOWTRACE } },
  testnet: true,
});

export function client() {
  return createPublicClient({ chain: fuji, transport: fujiTransport(), batch: { multicall: false } });
}

export const txUrl = (hash: string) => `${SNOWTRACE}/tx/${hash}`;
export const addressUrl = (a: string) => `${SNOWTRACE}/address/${a}`;
