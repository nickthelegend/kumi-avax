/**
 * Price candles from real data only.
 *  - The underlying's market price: public exchange candles (Coinbase Exchange AVAX-USD / BTC-USD, falling back to
 *    Binance AVAXUSDT / BTCUSDT when Coinbase does not answer). The source is returned so every chart labels it.
 *  - Chainlink: the actual Fuji feed rounds that mark Kumi's positions (getRoundData, walking back from the latest).
 *  - Kumi's own fills on KumiPerps, drawn as markers on the candle they landed in.
 * Nothing here invents a price: if no source answers, the caller shows an error.
 */
import type { PublicClient } from 'viem';

export type Interval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';
/** Candle lengths both sources serve (Coinbase granularities 60/300/900/3600/21600/86400, Binance klines intervals). */
export const INTERVALS: Record<Interval, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 };

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type CandleSource = { name: 'Coinbase' | 'Binance'; pair: string; url: string };
export type Fill = { ts: number; price: number; size: number; takerBuy: boolean };
export type Marker = Fill & { t: number };
export type Round = { roundId: bigint; ts: number; price: number };

const SYMS = ['AVAX', 'BTC', 'ETH', 'LINK', 'SOL', 'DOGE', 'SUI'] as const;
const COINBASE: Record<string, string> = Object.fromEntries(SYMS.map(s => [s, `${s}-USD`]));
const BINANCE: Record<string, string> = Object.fromEntries(SYMS.map(s => [s, `${s}USDT`]));

export type Stats = { symbol: string; last: number; open: number; high: number; low: number; volume: number; changePct: number; source: CandleSource };
/** 24-hour stats of the underlying from Coinbase Exchange (last trade, 24 h open/high/low/volume). Throws if it does not answer. */
export async function fetchStats(symbol: string, fetchImpl: typeof fetch = fetch): Promise<Stats> {
  const sym = symbol.toUpperCase();
  const pair = COINBASE[sym];
  if (!pair) throw Error(`No price source for ${sym}`);
  const url = `https://api.exchange.coinbase.com/products/${pair}/stats`;
  const r = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw Error(`Coinbase ${pair} stats: HTTP ${r.status}`);
  const j = (await r.json()) as Record<string, string>;
  const [last, open, high, low, volume] = ['last', 'open', 'high', 'low', 'volume'].map(k => Number(j[k]));
  if (!(last! > 0 && open! > 0)) throw Error(`Coinbase ${pair} stats: no price`);
  return { symbol: sym, last: last!, open: open!, high: high!, low: low!, volume: volume!, changePct: ((last! - open!) / open!) * 100, source: { name: 'Coinbase', pair, url } };
}

/** Coinbase rows: [time, low, high, open, close, volume], newest first. */
export function parseCoinbase(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw Error(`Coinbase returned ${JSON.stringify(rows).slice(0, 120)}`);
  return rows
    .map(r => { const [t, l, h, o, c, v] = r as number[]; return { t: Number(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v) }; })
    .filter(validCandle)
    .sort((a, b) => a.t - b.t);
}

/** Binance rows: [openTimeMs, open, high, low, close, volume, ...], oldest first. */
export function parseBinance(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw Error(`Binance returned ${JSON.stringify(rows).slice(0, 120)}`);
  return rows
    .map(r => { const x = r as (string | number)[]; return { t: Math.floor(Number(x[0]) / 1000), o: Number(x[1]), h: Number(x[2]), l: Number(x[3]), c: Number(x[4]), v: Number(x[5]) }; })
    .filter(validCandle)
    .sort((a, b) => a.t - b.t);
}

const validCandle = (c: Candle) => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) && c.h >= c.l && c.o > 0;

/** Fetches up to `limit` candles of the underlying. Tries Coinbase, then Binance; throws with both errors if neither answers. */
export async function fetchCandles(symbol: string, interval: Interval, limit = 120, fetchImpl: typeof fetch = fetch): Promise<{ candles: Candle[]; source: CandleSource }> {
  const sec = INTERVALS[interval];
  const sym = symbol.toUpperCase();
  const errors: string[] = [];
  if (COINBASE[sym]) {
    const url = `https://api.exchange.coinbase.com/products/${COINBASE[sym]}/candles?granularity=${sec}`;
    try {
      const r = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const candles = parseCoinbase(await r.json()).slice(-limit);
      if (candles.length) return { candles, source: { name: 'Coinbase', pair: COINBASE[sym]!, url } };
      errors.push('Coinbase: no candles');
    } catch (e) { errors.push(`Coinbase: ${(e as Error).message}`); }
  }
  if (BINANCE[sym]) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${BINANCE[sym]}&interval=${interval}&limit=${limit}`;
    try {
      const r = await fetchImpl(url);
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const candles = parseBinance(await r.json());
      if (candles.length) return { candles, source: { name: 'Binance', pair: BINANCE[sym]!, url } };
      errors.push('Binance: no candles');
    } catch (e) { errors.push(`Binance: ${(e as Error).message}`); }
  }
  throw Error(`No candle source answered for ${sym} (${errors.join('; ') || 'unknown symbol'})`);
}

export const bucketOf = (ts: number, sec: number) => ts - (ts % sec);

/** Builds OHLC candles from price points (Kumi fills or Chainlink rounds). Gaps stay gaps: no candle is invented. */
export function buildCandles(points: { ts: number; price: number; size?: number }[], sec: number): Candle[] {
  const out = new Map<number, Candle>();
  for (const p of [...points].sort((a, b) => a.ts - b.ts)) {
    if (!(p.price > 0) || !Number.isFinite(p.ts)) continue;
    const t = bucketOf(p.ts, sec);
    const c = out.get(t);
    if (!c) out.set(t, { t, o: p.price, h: p.price, l: p.price, c: p.price, v: p.size ?? 0 });
    else { c.h = Math.max(c.h, p.price); c.l = Math.min(c.l, p.price); c.c = p.price; c.v += p.size ?? 0; }
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/** Pins each fill to the candle it landed in; fills outside the candle range are dropped (not stretched). */
export function markersFor(candles: Candle[], fills: Fill[], sec: number): Marker[] {
  if (!candles.length) return [];
  const first = candles[0]!.t, last = candles[candles.length - 1]!.t + sec;
  return fills.filter(f => f.ts >= first && f.ts < last).map(f => ({ ...f, t: bucketOf(f.ts, sec) }));
}

/** Price range covering candles plus any extra prices (markers, Chainlink), padded so wicks don't touch the edge. */
export function rangeOf(candles: Candle[], extra: number[] = [], pad = 0.06): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const c of candles) { min = Math.min(min, c.l); max = Math.max(max, c.h); }
  for (const p of extra) if (p > 0) { min = Math.min(min, p); max = Math.max(max, p); }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  const span = max - min || max * 0.01 || 1;
  return { min: min - span * pad, max: max + span * pad };
}

/** "Nice" axis ticks for a price range. */
export function priceTicks(min: number, max: number, count = 4): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const roundAbi = [
  { type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] },
  { type: 'function', name: 'getRoundData', stateMutability: 'view', inputs: [{ type: 'uint80' }], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] },
] as const;

/** The last `count` Chainlink rounds of a feed (price 1e8 → number), oldest first. Stops at a phase boundary. */
export async function chainlinkRounds(client: PublicClient, feed: `0x${string}`, count = 24): Promise<Round[]> {
  const latest = await client.readContract({ address: feed, abi: roundAbi, functionName: 'latestRoundData' });
  const id = latest[0];
  const phaseStart = (id >> 64n) << 64n;
  const ids: bigint[] = [];
  for (let i = 1n; i < BigInt(count) && id - i > phaseStart; i++) ids.push(id - i);
  const rows = await Promise.all(ids.map(r => client.readContract({ address: feed, abi: roundAbi, functionName: 'getRoundData', args: [r] }).catch(() => null)));
  const out: Round[] = [{ roundId: id, ts: Number(latest[3]), price: Number(latest[1]) / 1e8 }];
  for (const r of rows) if (r && r[3] > 0n && r[1] > 0n) out.push({ roundId: r[0], ts: Number(r[3]), price: Number(r[1]) / 1e8 });
  return out.sort((a, b) => a.ts - b.ts);
}
