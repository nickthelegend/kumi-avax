import { defineChain, createPublicClient, http, fallback } from 'viem';

export const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
export const SNOWTRACE = 'https://testnet.snowtrace.io';

export const fuji = defineChain({
  id: 43113,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [FUJI_RPC] } },
  blockExplorers: { default: { name: 'Snowtrace', url: SNOWTRACE } },
  testnet: true,
});

export function client(rpc: string = FUJI_RPC) {
  return createPublicClient({ chain: fuji, transport: fallback([http(rpc, { retryCount: 3, timeout: 15_000 })]), batch: { multicall: false } });
}

export const txUrl = (hash: string) => `${SNOWTRACE}/tx/${hash}`;
export const addressUrl = (a: string) => `${SNOWTRACE}/address/${a}`;
