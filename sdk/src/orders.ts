/**
 * Order encoding for KumiPerps.placeOrder(market, isBuy, price, size, flags), shared by the web ticket, the phone
 * ticket, the lobby "copy" flow and the seed scripts. All maths in bigint, in the venue's units:
 * price 1e8 (Chainlink decimals), size 1e18, money 1e6 (tUSDC). notional = size * price / 1e20.
 */
import { MARKETS, PX_SIZE, VENUE } from './markets.ts';

export const FLAG = { IOC: 1, REDUCE_ONLY: 2, POST_ONLY: 4 } as const;

export type Market = (typeof MARKETS)[number];
export type OrderKind = 'market' | 'limit';
export type OrderArgs = readonly [market: number, isBuy: boolean, price: bigint, size: bigint, flags: number];

/** Rounds a price onto the market's tick: buys round up (never worse than asked to pay), sells round down. */
export function toTick(m: Pick<Market, 'tick'>, price: bigint, roundUp: boolean): bigint {
  const r = price % m.tick;
  if (r === 0n) return price;
  return roundUp ? price + (m.tick - r) : price - r;
}

/** Rounds a size down onto the market's lot. */
export function toLot(m: Pick<Market, 'lot'>, size: bigint): bigint {
  return size - (size % m.lot);
}

/** Size (1e18) for a margin (1e6) at a leverage and a price (1e8): notional = margin * leverage. */
export function sizeFor(m: Pick<Market, 'lot'>, margin: bigint, leverage: number, price: bigint): bigint {
  if (price <= 0n) throw Error('No price to size the order against');
  return toLot(m, (margin * BigInt(leverage) * PX_SIZE) / price);
}

/** Notional in tUSDC (1e6) of a size at a price. */
export const notionalOf = (size: bigint, price: bigint) => (size * price) / PX_SIZE;

/** Initial margin the venue holds for a size at a price (imBps of notional, rounded up). */
export function initialMargin(size: bigint, price: bigint, imBps: number = VENUE.imBps): bigint {
  const n = size * price * BigInt(imBps);
  const d = PX_SIZE * 10_000n;
  return (n + d - 1n) / d;
}

/**
 * Limit price for a marketable (IOC) order: the touch plus `slippageBps`, kept inside the venue's band around the
 * Chainlink price (orders outside ±bandBps revert with OutsideBand).
 */
export function marketLimit(m: Pick<Market, 'tick'>, isBuy: boolean, touch: bigint, oracle: bigint, slippageBps = 50, bandBps: number = VENUE.bandBps): bigint {
  const ref = touch > 0n ? touch : oracle;
  const raw = isBuy ? (ref * BigInt(10_000 + slippageBps)) / 10_000n : (ref * BigInt(10_000 - slippageBps)) / 10_000n;
  const hi = (oracle * BigInt(10_000 + bandBps)) / 10_000n;
  const lo = (oracle * BigInt(10_000 - bandBps) + 9_999n) / 10_000n;
  const clamped = raw > hi ? hi : raw < lo ? lo : raw;
  // Rounding toward the inside of the band keeps the clamp valid.
  return isBuy ? (toTick(m, clamped, true) > hi ? toTick(m, clamped, false) : toTick(m, clamped, true)) : (toTick(m, clamped, false) < lo ? toTick(m, clamped, true) : toTick(m, clamped, false));
}

export type Ticket = {
  market: number;
  isBuy: boolean;
  kind: OrderKind;
  /** limit price (1e8); ignored for market orders */
  price?: bigint;
  size: bigint;
  reduceOnly?: boolean;
  postOnly?: boolean;
};

/** Encodes a ticket into placeOrder arguments, validating tick, lot and flags. */
export function encodeOrder(t: Ticket, ctx: { touch: bigint; oracle: bigint; slippageBps?: number }): OrderArgs {
  const m = MARKETS[t.market];
  if (!m) throw Error(`Unknown market ${t.market}`);
  if (t.size <= 0n) throw Error('Size must be above zero');
  if (t.size % m.lot !== 0n) throw Error(`Size must be a multiple of the lot (${m.lot})`);
  let flags = 0;
  if (t.reduceOnly) flags |= FLAG.REDUCE_ONLY;
  if (t.kind === 'market') {
    if (t.postOnly) throw Error('A market order cannot be post-only');
    flags |= FLAG.IOC;
    return [t.market, t.isBuy, marketLimit(m, t.isBuy, ctx.touch, ctx.oracle, ctx.slippageBps), t.size, flags] as const;
  }
  if (!t.price || t.price <= 0n) throw Error('A limit order needs a price');
  if (t.price % m.tick !== 0n) throw Error(`Price must be a multiple of the tick (${m.tick})`);
  if (t.postOnly) flags |= FLAG.POST_ONLY;
  return [t.market, t.isBuy, t.price, t.size, flags] as const;
}

/** Parses a human decimal ("8.734", "0.25") into a scaled bigint, without floating point. */
export function parseDecimal(text: string, decimals: number): bigint {
  const s = text.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw Error(`"${text}" is not a number`);
  const [i, f = ''] = s.split('.');
  if (f.length > decimals) throw Error(`At most ${decimals} decimals`);
  return BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
