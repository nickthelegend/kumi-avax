/** The KumiPerps markets on Fuji: one per Chainlink Avalanche Fuji USD feed that exists. Feed addresses from Chainlink's
 *  Avalanche Fuji feed directory (https://reference-data-directory.vercel.app/feeds-avalanche-fuji-testnet.json).
 *  AVAX and BTC were listed at deploy; ETH and LINK were listed on Nov 14 2026 (scripts/fuji/list-markets.ts). */
export const MARKETS = [
  { id: 0, symbol: 'AVAX', pair: 'AVAX-USD', feed: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', heartbeat: 600, maxAge: 1800, tick: 100000n, lot: 10n ** 16n, priceDp: 3, sizeDp: 2 },
  { id: 1, symbol: 'BTC', pair: 'BTC-USD', feed: '0x31CF013A08c6Ac228C94551d535d5BAfE19c602a', heartbeat: 86400, maxAge: 93600, tick: 100000000n, lot: 10n ** 13n, priceDp: 0, sizeDp: 5 },
  { id: 2, symbol: 'ETH', pair: 'ETH-USD', feed: '0x86d67c3D38D2bCeE722E601025C25a575021c6EA', heartbeat: 86400, maxAge: 93600, tick: 1000000n, lot: 10n ** 15n, priceDp: 2, sizeDp: 3 },
  { id: 3, symbol: 'LINK', pair: 'LINK-USD', feed: '0x34C4c526902d88a3Aa98DB8a9b802603EB1E3470', heartbeat: 86400, maxAge: 93600, tick: 100000n, lot: 10n ** 16n, priceDp: 3, sizeDp: 2 },
] as const;
export type MarketSym = (typeof MARKETS)[number]['symbol'];
export const marketBySymbol = (s: string) => MARKETS.find(m => m.symbol === s.toUpperCase());

/** Coins Kumi charts with real Coinbase prices but cannot trade: Chainlink has no Fuji feed for them, so KumiPerps
 *  (which marks every position at Chainlink) cannot list them. Shown as "Watch" markets, never with a trade ticket. */
export const WATCH = [
  { symbol: 'SOL', pair: 'SOL-USD', priceDp: 2 },
  { symbol: 'DOGE', pair: 'DOGE-USD', priceDp: 5 },
  { symbol: 'SUI', pair: 'SUI-USD', priceDp: 4 },
] as const;
export type WatchSym = (typeof WATCH)[number]['symbol'];
/** Every coin Kumi shows a chart for: the tradable KumiPerps markets first, then the watch-only ones. */
export const COINS: { symbol: string; pair: string; priceDp: number; market?: number }[] = [
  ...MARKETS.map(m => ({ symbol: m.symbol, pair: m.pair, priceDp: m.priceDp, market: m.id })),
  ...WATCH.map(w => ({ symbol: w.symbol, pair: w.pair, priceDp: w.priceDp })),
];

/** Venue parameters used at listing (bps). */
export const VENUE = { imBps: 1000, mmBps: 500, bandBps: 500, liqFeeBps: 100 } as const;

export const PX = 10n ** 8n; // price scale (Chainlink decimals)
export const SIZE = 10n ** 18n; // size scale
export const USD = 10n ** 6n; // tUSDC scale
export const PX_SIZE = 10n ** 20n;
