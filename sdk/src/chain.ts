import { defineChain, createPublicClient, http, fallback } from 'viem';

export const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
/** Second public Fuji RPC (PublicNode), used when the Avalanche one rate-limits. */
export const FUJI_RPC_2 = 'https://avalanche-fuji-c-chain-rpc.publicnode.com';
export const fujiTransport = () => fallback([http(FUJI_RPC, { retryCount: 2, timeout: 15_000 }), http(FUJI_RPC_2, { retryCount: 2, timeout: 15_000 })]);
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
