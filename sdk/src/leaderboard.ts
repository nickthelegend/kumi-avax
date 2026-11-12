/**
 * Caller leaderboard and reputation (v2.2), from on-chain data only:
 *  - every trade call in KumiLobby, with the Chainlink price the lobby stored when it was called;
 *  - Chainlink Fuji now, the same mark KumiPerps uses;
 *  - every copy KumiLobby recorded (checked against the venue when it was posted);
 *  - every KumiPerps fill (Filled events), replayed per account and market, first in first out, so each copy's own
 *    order (its `orderTx`) is a lot whose later closes are its realised PnL and whose open rest is unrealised.
 * A call "wins" when its leveraged move from the call price to Chainlink now is above zero. PnL is before funding.
 */
import type { Address, Hex, PublicClient } from 'viem';
import { lobbyAbi, perpsAbi } from './abi.ts';
import { readChannelMessages, type ChatItem } from './chat.ts';
import { MARKETS, PX_SIZE } from './markets.ts';

export type VenueFill = { market: number; maker: Address; taker: Address; takerBuy: boolean; price: bigint; size: bigint; block: bigint; logIndex: number; tx: Hex };

const CHUNK = 2000n;
const cache = new Map<string, { fills: VenueFill[]; to: bigint }>();

/** Every KumiPerps fill from `fromBlock` (the venue's deploy block) to the latest block, in chain order. Cached and incremental. */
export async function readFills(client: PublicClient, perps: Address, fromBlock: bigint, latest?: bigint): Promise<VenueFill[]> {
  const key = `${perps.toLowerCase()}:${fromBlock}`;
  const head = latest ?? (await client.getBlockNumber());
  const have = cache.get(key) ?? { fills: [], to: fromBlock - 1n };
  if (have.to >= head) return have.fills;
  const ranges: [bigint, bigint][] = [];
  for (let a = have.to + 1n; a <= head; a += CHUNK) ranges.push([a, a + CHUNK - 1n > head ? head : a + CHUNK - 1n]);
  const out: VenueFill[][] = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      const [a, b] = ranges[i]!;
      let tries = 0;
      for (;;) {
        try {
          const logs = await client.getContractEvents({ address: perps, abi: perpsAbi, eventName: 'Filled', fromBlock: a, toBlock: b });
          out[i] = logs.map(l => {
            const x = l.args as { market: number; maker: Address; taker: Address; takerBuy: boolean; price: bigint; size: bigint };
            return { market: Number(x.market), maker: x.maker, taker: x.taker, takerBuy: x.takerBuy, price: x.price, size: x.size, block: l.blockNumber!, logIndex: l.logIndex!, tx: l.transactionHash! };
          });
          break;
        } catch (e) {
          if (++tries >= 4) throw Error(`Could not read KumiPerps fills for blocks ${a}-${b}: ${(e as Error).message.split('\n')[0]}`);
          await new Promise(r => setTimeout(r, 600 * tries));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ranges.length) }, worker));
  const fills = [...have.fills, ...out.flat()].sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));
  cache.set(key, { fills, to: head });
  return fills;
}

export type Lot = { tx: Hex; size: bigint; price: bigint; realized: bigint };

/**
 * Replays one account's fills in one market, first in first out. Returns every lot it opened (signed size still
 * open, entry price, realised PnL of the part closed so far), in 1e6 tUSDC. A copy is the lot(s) its order opened.
 */
export function lotsFor(fills: VenueFill[], who: Address, market: number): Lot[] {
  const me = who.toLowerCase();
  const all: Lot[] = [];
  let open: Lot[] = [];
  for (const f of fills) {
    if (f.market !== market) continue;
    const isTaker = f.taker.toLowerCase() === me;
    const isMaker = f.maker.toLowerCase() === me;
    if (isTaker === isMaker) continue; // not this account, or a self-trade (no change)
    const bought = isTaker ? f.takerBuy : !f.takerBuy;
    let rest = bought ? f.size : -f.size;
    while (rest !== 0n && open.length && (open[0]!.size > 0n) !== (rest > 0n)) {
      const lot = open[0]!;
      const absLot = lot.size < 0n ? -lot.size : lot.size;
      const absRest = rest < 0n ? -rest : rest;
      const q = absLot < absRest ? absLot : absRest;
      const signedQ = lot.size > 0n ? q : -q;
      lot.realized += (signedQ * (f.price - lot.price)) / PX_SIZE;
      lot.size -= signedQ;
      rest += signedQ;
      if (lot.size === 0n) open = open.slice(1);
    }
    if (rest !== 0n) {
      const lot: Lot = { tx: f.tx, size: rest, price: f.price, realized: 0n };
      // fills of one order at different levels are one lot per level; keep them separate for exact pricing
      open.push(lot);
      all.push(lot);
    }
  }
  return all;
}

export type CopyStat = { who: Address; size: bigint; entry: bigint; realized: bigint; unrealized: bigint; open: bigint; exact: boolean };
export type CallStat = {
  channel: number; index: number; who: Address; market: number; isLong: boolean; leverage: number; margin: bigint; ts: number;
  /** Chainlink when called and now (1e8) */
  entry: bigint; mark: bigint;
  /** leveraged move in basis points (null when the feed was stale at call time); win is null while the move is exactly 0 */
  returnBps: number | null; win: boolean | null;
  copies: CopyStat[]; copyPnl: bigint;
};
export type CallerStat = { who: Address; calls: number; scored: number; wins: number; winRate: number | null; avgReturnBps: number | null; copies: number; copyPnl: bigint; copyRealized: bigint; best: CallStat | null; rank: number };
export type Leaderboard = { at: number; head: bigint; marks: bigint[]; calls: CallStat[]; global: CallerStat[]; byChannel: Record<number, CallerStat[]>; channels: { id: number; name: string }[] };

/** Leveraged move from `entry` to `mark` for one side, in basis points. */
export function callReturnBps(entry: bigint, mark: bigint, isLong: boolean, leverage: number): number {
  if (entry === 0n) return 0;
  const move = Number(((mark - entry) * 1_000_000n) / entry) / 100; // bps, 2 dp
  return Math.round((isLong ? move : -move) * leverage * 100) / 100 || 0;
}

/** Copy PnL from its own lots: realised on the closed part, unrealised on the open rest at `mark`. */
export function copyStat(c: ChatItem, lots: Lot[], mark: bigint): CopyStat {
  const mine = c.orderTx ? lots.filter(l => l.tx.toLowerCase() === c.orderTx!.toLowerCase()) : [];
  if (mine.length) {
    let realized = 0n, unrealized = 0n, open = 0n, size = 0n, notional = 0n;
    for (const l of mine) {
      realized += l.realized;
      unrealized += (l.size * (mark - l.price)) / PX_SIZE;
      open += l.size < 0n ? -l.size : l.size;
    }
    // the size and entry the order filled at (before any close): rebuild from realised = closed * (exit - entry)
    for (const l of mine) { const s = l.size < 0n ? -l.size : l.size; size += s; notional += s * l.price; }
    return { who: c.who, size: c.size ?? size, entry: c.price ?? (size ? notional / size : 0n), realized, unrealized, open, exact: true };
  }
  // No fill in that tx (an older copy without an order hash): mark the recorded size and entry, all unrealised.
  const s = c.size ?? 0n;
  const signed = c.isLong ? s : -s;
  return { who: c.who, size: s, entry: c.price ?? 0n, realized: 0n, unrealized: (signed * (mark - (c.price ?? mark))) / PX_SIZE, open: s, exact: false };
}

function rankCallers(calls: CallStat[]): CallerStat[] {
  const by = new Map<string, CallerStat>();
  for (const c of calls) {
    const k = c.who.toLowerCase();
    const s = by.get(k) ?? { who: c.who, calls: 0, scored: 0, wins: 0, winRate: null, avgReturnBps: null, copies: 0, copyPnl: 0n, copyRealized: 0n, best: null, rank: 0 };
    s.calls++;
    s.copies += c.copies.length;
    s.copyPnl += c.copyPnl;
    s.copyRealized += c.copies.reduce((a, x) => a + x.realized, 0n);
    if (c.returnBps !== null && c.win !== null) {
      s.avgReturnBps = ((s.avgReturnBps ?? 0) * s.scored + c.returnBps) / (s.scored + 1);
      s.scored++;
      if (c.win) s.wins++;
      if (!s.best || (s.best.returnBps ?? -Infinity) < c.returnBps) s.best = c;
    }
    by.set(k, s);
  }
  const list = [...by.values()].map(s => ({ ...s, winRate: s.scored ? s.wins / s.scored : null, avgReturnBps: s.avgReturnBps === null ? null : Math.round(s.avgReturnBps * 100) / 100 }));
  // Rank by win rate smoothed toward 50% (one lucky call does not top the board), then by average return.
  const score = (s: CallerStat) => (s.wins + 1) / (s.scored + 2);
  // Callers with no scored call yet go last.
  list.sort((a, b) => (b.scored > 0 ? 1 : 0) - (a.scored > 0 ? 1 : 0) || score(b) - score(a) || (b.avgReturnBps ?? -1e9) - (a.avgReturnBps ?? -1e9) || b.copies - a.copies);
  list.forEach((s, i) => { s.rank = i + 1; });
  return list;
}

/** The whole board from Fuji: per call, per caller (global and per public chat). */
export async function readLeaderboard(client: PublicClient, opts: { lobby: Address; perps: Address; fromBlock: bigint; feeds?: readonly Address[] }): Promise<Leaderboard> {
  const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;
  const head = await client.getBlockNumber();
  const [chans, marks, fills] = await Promise.all([
    client.readContract({ address: opts.lobby, abi: lobbyAbi, functionName: 'allChannels' }),
    Promise.all(MARKETS.map((m, i) => client.readContract({ address: (opts.feeds?.[i] ?? m.feed) as Address, abi: feedAbi, functionName: 'latestRoundData' }).then(r => r[1]))),
    readFills(client, opts.perps, opts.fromBlock, head),
  ]);
  const feeds = await Promise.all(chans.map((_, i) => readChannelMessages(client, opts.lobby, i, 400)));
  const lotCache = new Map<string, Lot[]>();
  const lots = (who: Address, market: number) => {
    const k = `${who.toLowerCase()}:${market}`;
    if (!lotCache.has(k)) lotCache.set(k, lotsFor(fills, who, market));
    return lotCache.get(k)!;
  };
  const calls: CallStat[] = [];
  feeds.forEach((items, channel) => {
    const copies = new Map<number, ChatItem[]>();
    for (const it of items) if (it.kind === 'copy') copies.set(it.ref, [...(copies.get(it.ref) ?? []), it]);
    for (const it of items) {
      if (it.kind !== 'call') continue;
      const market = it.market ?? 0;
      const mark = marks[market]!;
      const entry = it.price ?? 0n;
      const ret = entry ? callReturnBps(entry, mark, !!it.isLong, it.leverage ?? 1) : null;
      const cs = (copies.get(it.index) ?? []).map(c => copyStat(c, lots(c.who, market), mark));
      calls.push({
        channel, index: it.index, who: it.who, market, isLong: !!it.isLong, leverage: it.leverage ?? 1, margin: it.amount, ts: it.ts,
        entry, mark, returnBps: ret, win: ret === null || ret === 0 ? null : ret > 0, copies: cs, copyPnl: cs.reduce((a, c) => a + c.realized + c.unrealized, 0n),
      });
    }
  });
  const byChannel: Record<number, CallerStat[]> = {};
  chans.forEach((_, i) => { byChannel[i] = rankCallers(calls.filter(c => c.channel === i)); });
  return { at: Date.now(), head, marks, calls, global: rankCallers(calls), byChannel, channels: chans.map((c, i) => ({ id: i, name: c.name })) };
}

/** A caller's stat from a board, or null when they have no calls. */
export const callerOf = (b: Leaderboard | undefined, who: string, channel?: number) =>
  (channel === undefined ? b?.global : b?.byChannel[channel])?.find(s => s.who.toLowerCase() === who.toLowerCase()) ?? null;
