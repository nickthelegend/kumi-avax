/** The two Fuji markets. Feed addresses from Chainlink's Avalanche Fuji feed directory
 *  (https://reference-data-directory.vercel.app/feeds-avalanche-fuji-testnet.json). */
export const MARKETS = [
  { id: 0, symbol: 'AVAX', pair: 'AVAX-USD', feed: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', heartbeat: 600, maxAge: 1800, tick: 100000n, lot: 10n ** 16n, priceDp: 3, sizeDp: 2 },
  { id: 1, symbol: 'BTC', pair: 'BTC-USD', feed: '0x31CF013A08c6Ac228C94551d535d5BAfE19c602a', heartbeat: 86400, maxAge: 93600, tick: 100000000n, lot: 10n ** 13n, priceDp: 0, sizeDp: 5 },
] as const;
export type MarketSym = (typeof MARKETS)[number]['symbol'];
export const marketBySymbol = (s: string) => MARKETS.find(m => m.symbol === s.toUpperCase());

/** Venue parameters used at listing (bps). */
export const VENUE = { imBps: 1000, mmBps: 500, bandBps: 500, liqFeeBps: 100 } as const;

export const PX = 10n ** 8n; // price scale (Chainlink decimals)
export const SIZE = 10n ** 18n; // size scale
export const USD = 10n ** 6n; // tUSDC scale
export const PX_SIZE = 10n ** 20n;
