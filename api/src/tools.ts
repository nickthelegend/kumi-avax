/**
 * Kumi AI's tools: read-only views over live Fuji (the KumiPerps book and fills, Chainlink, the chat, the caller
 * board, the asker's positions) and one tool that drafts a trade call. Nothing here signs or sends a transaction.
 */
import type { Address, PublicClient } from 'viem';
import {
  DEPLOYMENT, MARKETS, type MarketSym, crewAbi, factoryAbi, lobbyAbi, perpsAbi, readChannelMessages, readCrewMessages, readLeaderboard, marketBySymbol,
  price as fmtPrice, size as fmtSize, usd as fmtUsd, type Leaderboard, type CallerStat,
} from '@kumi-avax/sdk';

const PERPS = DEPLOYMENT.perps as Address;
const LOBBY = DEPLOYMENT.lobby as Address;
const NAMES = DEPLOYMENT.names as Record<string, string>;
const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;

export const nameOf = (a: string) => NAMES[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
const addrOf = (who: string): Address | null => {
  const t = who.trim().toLowerCase().replace(/^@/, '');
  if (/^0x[0-9a-f]{40}$/.test(t)) return t as Address;
  const hit = Object.entries(NAMES).find(([, n]) => n.toLowerCase() === t);
  return hit ? (hit[0] as Address) : null;
};
const bps = (v: number | null) => (v === null ? null : `${v > 0 ? '+' : ''}${(v / 100).toFixed(2)}%`);

export type Chat = { kind: 'lobby'; channel: number; name: string } | { kind: 'crew'; crew: Address; name: string };
export type Draft = { market: MarketSym; side: 'long' | 'short'; leverage: number; marginUsdc?: number; sizePct?: number; note?: string; command?: string };
export type Ctx = { pub: PublicClient; chat: Chat; me: Address; board: () => Promise<Leaderboard>; draft?: Draft };

const market = (s: unknown) => {
  const m = marketBySymbol(String(s ?? 'AVAX'));
  if (!m) throw Error(`Unknown market ${String(s)}: Kumi lists ${MARKETS.map(x => x.symbol).join(', ')} on KumiPerps.`);
  return m;
};

let boardCache: { at: number; p: Promise<Leaderboard> } | null = null;
/** The caller board, shared for 30 s within one warm instance. */
export function cachedBoard(pub: PublicClient): () => Promise<Leaderboard> {
  return () => {
    if (!boardCache || Date.now() - boardCache.at > 30_000) {
      const p = readLeaderboard(pub, { lobby: LOBBY, perps: PERPS, fromBlock: BigInt(DEPLOYMENT.perpsDeployBlock) });
      boardCache = { at: Date.now(), p };
      p.catch(() => { boardCache = null; });
    }
    return boardCache.p;
  };
}

const caller = (s: CallerStat) => ({
  rank: s.rank, caller: nameOf(s.who), calls: s.calls, scored: s.scored, wins: s.wins,
  winRate: s.winRate === null ? null : `${Math.round(s.winRate * 100)}%`, avgReturn: bps(s.avgReturnBps), copies: s.copies,
  copiersPnlUsd: fmtUsd(s.copyPnl), copiersRealizedUsd: fmtUsd(s.copyRealized),
});

export const TOOLS = [
  { name: 'order_book', description: 'The live KumiPerps on-chain order book for a market on Avalanche Fuji: best bid/ask, spread, top levels, the last fills, open interest and the Chainlink mark.',
    input_schema: { type: 'object', properties: { market: { type: 'string', enum: MARKETS.map(x => x.symbol) } }, required: ['market'], additionalProperties: false } },
  { name: 'chainlink_price', description: 'Chainlink\'s Fuji price feed for AVAX/USD or BTC/USD (the venue\'s mark): price, last update, age, and whether the venue treats it as stale.',
    input_schema: { type: 'object', properties: { market: { type: 'string', enum: MARKETS.map(x => x.symbol) } }, required: ['market'], additionalProperties: false } },
  { name: 'chat_activity', description: 'This chat on Fuji: recent messages, and every trade call (or crew pitch) with its Chainlink price at call time, its move since, and its copies with their PnL.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'caller_record', description: 'One caller\'s track record from on-chain data: calls, win rate, average leveraged move, copies, and copiers\' PnL, globally and in this chat, plus their latest calls. Accepts a name like "mika" or an address.',
    input_schema: { type: 'object', properties: { caller: { type: 'string' } }, required: ['caller'], additionalProperties: false } },
  { name: 'top_callers', description: 'The caller leaderboard (on-chain data only): top callers in this chat or across all public chats.',
    input_schema: { type: 'object', properties: { scope: { type: 'string', enum: ['chat', 'all'] } }, required: ['scope'], additionalProperties: false } },
  { name: 'my_positions', description: 'The asker\'s own KumiPerps account: positions with entry, mark, unrealised PnL and liquidation price, margin and open orders.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'draft_call', description: 'Drafts a trade call card for the asker to review and sign themselves. It sends nothing. Use only when the asker asks for a call or a trade idea. In a public chat give marginUsdc; in a crew give sizePct (share of the crew fund).',
    input_schema: { type: 'object', properties: {
      market: { type: 'string', enum: MARKETS.map(x => x.symbol) }, side: { type: 'string', enum: ['long', 'short'] }, leverage: { type: 'integer', minimum: 1, maximum: 10 },
      marginUsdc: { type: 'number', minimum: 1, maximum: 1000 }, sizePct: { type: 'number', minimum: 1, maximum: 100 }, note: { type: 'string', maxLength: 140 },
    }, required: ['market', 'side', 'leverage'], additionalProperties: false } },
] as const;

export const LABEL: Record<string, (i: any) => string> = {
  order_book: i => `Order book · ${i?.market ?? 'AVAX'}`,
  chainlink_price: i => `Chainlink · ${i?.market ?? 'AVAX'}`,
  chat_activity: () => 'Calls in this chat',
  caller_record: i => `Track record · ${i?.caller ?? '?'}`,
  top_callers: i => (i?.scope === 'all' ? 'Top callers · all chats' : 'Top callers · this chat'),
  my_positions: () => 'Your positions',
  draft_call: i => `Draft · ${i?.side === 'short' ? 'Short' : 'Long'} ${i?.market ?? ''} ${i?.leverage ?? ''}x`,
};

export async function runTool(name: string, input: any, ctx: Ctx): Promise<unknown> {
  const { pub } = ctx;
  switch (name) {
    case 'order_book': {
      const m = market(input?.market);
      const [bids, asks, trades, info, feed] = await Promise.all([
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'depth', args: [m.id, true, 5n] }),
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'depth', args: [m.id, false, 5n] }),
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'recentTrades', args: [m.id, 5n] }),
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [m.id] }),
        pub.readContract({ address: m.feed as Address, abi: feedAbi, functionName: 'latestRoundData' }),
      ]);
      const lv = (d: readonly [readonly bigint[], readonly bigint[], readonly number[]]) => d[0].map((p, i) => ({ price: fmtPrice(p, m.priceDp), size: fmtSize(d[1][i]!, m.sizeDp), orders: d[2][i] }));
      const spread = info.bestBid && info.bestAsk ? Number(((info.bestAsk - info.bestBid) * 1_000_000n) / info.bestBid) / 100 : null;
      return {
        market: m.pair, venue: 'KumiPerps on Avalanche Fuji', bestBid: info.bestBid ? fmtPrice(info.bestBid, m.priceDp) : null, bestAsk: info.bestAsk ? fmtPrice(info.bestAsk, m.priceDp) : null,
        spreadBps: spread, chainlink: fmtPrice(feed[1], m.priceDp), bids: lv(bids), asks: lv(asks),
        lastFills: trades.map(t => ({ price: fmtPrice(t.price, m.priceDp), size: fmtSize(t.size, m.sizeDp), side: t.takerBuy ? 'buy' : 'sell', agoS: Math.round(Date.now() / 1000 - Number(t.ts)) })),
        openInterest: fmtSize(info.openInterest, m.sizeDp), fills: Number(info.tradeCount),
      };
    }
    case 'chainlink_price': {
      const m = market(input?.market);
      const r = await pub.readContract({ address: m.feed as Address, abi: feedAbi, functionName: 'latestRoundData' });
      const age = Math.round(Date.now() / 1000 - Number(r[3]));
      return { feed: `Chainlink ${m.symbol}/USD on Fuji`, address: m.feed, price: fmtPrice(r[1], m.priceDp), updatedAgoS: age, heartbeatS: m.heartbeat, staleForVenue: age > m.maxAge };
    }
    case 'chat_activity': {
      if (ctx.chat.kind === 'lobby') {
        const [items, board] = await Promise.all([readChannelMessages(pub, LOBBY, ctx.chat.channel, 120), ctx.board()]);
        const calls = board.calls.filter(c => c.channel === (ctx.chat as { channel: number }).channel).slice(-10).map(c => {
          const m = MARKETS[c.market]!;
          return { call: `#${c.index}`, by: nameOf(c.who), side: c.isLong ? 'long' : 'short', market: m.symbol, leverage: c.leverage, marginUsdc: fmtUsd(c.margin, 0),
            chainlinkAtCall: c.entry ? fmtPrice(c.entry, m.priceDp) : 'feed was stale', chainlinkNow: fmtPrice(c.mark, m.priceDp), moveSinceCall: bps(c.returnBps), agoMin: Math.round((Date.now() / 1000 - c.ts) / 60),
            copies: c.copies.map(x => ({ by: nameOf(x.who), size: fmtSize(x.size, m.sizeDp), realizedUsd: fmtUsd(x.realized), unrealizedUsd: fmtUsd(x.unrealized), stillOpen: x.open > 0n })) };
        });
        const chat = items.filter(i => i.kind === 'chat').slice(-12).map(i => ({ by: nameOf(i.who), text: i.text, agoMin: Math.round((Date.now() / 1000 - i.ts) / 60) }));
        return { chat: ctx.chat.name, kind: 'public chat (KumiLobby)', calls, recentMessages: chat };
      }
      const crew = ctx.chat.crew;
      const [items, nav] = await Promise.all([readCrewMessages(pub, crew, 80), pub.readContract({ address: crew, abi: crewAbi, functionName: 'nav' }).catch(() => 0n)]);
      return {
        chat: ctx.chat.name, kind: 'crew vault (KumiCrew): members pitch trades and vote with their shares', navUsd: fmtUsd(nav),
        pitchesAndFills: items.filter(i => ['pitch', 'executed', 'failed', 'captain', 'ragequit', 'deposit'].includes(i.kind)).slice(-12).map(i => ({ kind: i.kind, by: nameOf(i.who), text: i.text, amountUsd: i.amount ? fmtUsd(i.amount) : undefined, ref: i.ref, agoMin: Math.round((Date.now() / 1000 - i.ts) / 60) })),
        recentMessages: items.filter(i => i.kind === 'chat').slice(-12).map(i => ({ by: nameOf(i.who), text: i.text })),
      };
    }
    case 'caller_record': {
      const a = addrOf(String(input?.caller ?? ''));
      if (!a) return { error: `No Kumi caller named "${input?.caller}".` };
      const b = await ctx.board();
      const g = b.global.find(s => s.who.toLowerCase() === a);
      if (!g) return { caller: nameOf(a), calls: 0, note: 'No trade calls from this wallet in the public chats yet.' };
      const here = ctx.chat.kind === 'lobby' ? b.byChannel[ctx.chat.channel]?.find(s => s.who.toLowerCase() === a) : undefined;
      const last = b.calls.filter(c => c.who.toLowerCase() === a).slice(-5).map(c => ({ chat: b.channels[c.channel]?.name, call: `#${c.index}`, side: c.isLong ? 'long' : 'short', market: MARKETS[c.market]!.symbol, leverage: c.leverage, moveSinceCall: bps(c.returnBps), copies: c.copies.length }));
      return { global: caller(g), thisChat: here ? caller(here) : null, latestCalls: last, method: 'win = leveraged move from the Chainlink price at call time to Chainlink now is above zero; copiers PnL from their KumiPerps fills, before funding' };
    }
    case 'top_callers': {
      const b = await ctx.board();
      const list = input?.scope === 'all' || ctx.chat.kind !== 'lobby' ? b.global : b.byChannel[ctx.chat.channel] ?? [];
      return { scope: input?.scope === 'all' || ctx.chat.kind !== 'lobby' ? 'all public chats' : ctx.chat.name, top: list.slice(0, 5).map(caller), totalCallers: list.length };
    }
    case 'my_positions': {
      const [pos, health, collateral] = await Promise.all([
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'positionsOf', args: [ctx.me] }),
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'health', args: [ctx.me] }).catch(() => null),
        pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'collateral', args: [ctx.me] }),
      ]);
      return {
        wallet: nameOf(ctx.me), marginUsdc: fmtUsd(collateral), equityUsdc: health ? fmtUsd(health[0]) : null,
        positions: pos.map(p => { const m = MARKETS[p.market]!; return { market: m.symbol, side: p.size > 0n ? 'long' : 'short', size: fmtSize(p.size < 0n ? -p.size : p.size, m.sizeDp), entry: fmtPrice(p.entry, m.priceDp), mark: fmtPrice(p.mark, m.priceDp), unrealizedUsd: fmtUsd(p.unrealized), liquidationPrice: p.liqPrice ? fmtPrice(p.liqPrice, m.priceDp) : null }; }),
      };
    }
    case 'draft_call': {
      const m = market(input?.market);
      const side = input?.side === 'short' ? 'short' : 'long';
      const lev = Math.round(Number(input?.leverage));
      if (!(lev >= 1 && lev <= 10)) return { error: 'Leverage must be 1x to 10x.' };
      const note = typeof input?.note === 'string' ? input.note.slice(0, 140) : undefined;
      if (ctx.chat.kind === 'crew') {
        const policy = await pub.readContract({ address: ctx.chat.crew, abi: crewAbi, functionName: 'policy' });
        const maxLev = Number(policy[2]);
        if (lev > maxLev) return { error: `This crew allows at most ${maxLev}x.` };
        const pct = Math.min(100, Math.max(1, Math.round(Number(input?.sizePct ?? 20))));
        ctx.draft = { market: m.symbol, side, leverage: lev, sizePct: pct, note, command: `/${side} ${m.symbol} ${lev}x ${pct}%` };
      } else {
        const margin = Math.min(1000, Math.max(1, Math.round(Number(input?.marginUsdc ?? 50))));
        ctx.draft = { market: m.symbol, side, leverage: lev, marginUsdc: margin, note };
      }
      return { drafted: ctx.draft, note: 'Shown to the asker as a card. They review it and sign it themselves; nothing was sent.' };
    }
  }
  return { error: `Unknown tool ${name}` };
}

/** Is `who` in this chat on-chain? */
export async function isMemberOf(pub: PublicClient, chat: Chat, who: Address): Promise<boolean> {
  if (chat.kind === 'lobby') return pub.readContract({ address: LOBBY, abi: lobbyAbi, functionName: 'isMember', args: [BigInt(chat.channel), who] });
  return pub.readContract({ address: chat.crew, abi: crewAbi, functionName: 'isMember', args: [who] });
}

/** `l-<n>` or `c-<vault>` (the apps' chat ids) to a chat, with its on-chain name. */
export async function chatOf(pub: PublicClient, id: string): Promise<Chat> {
  if (/^l-\d+$/.test(id)) {
    const n = Number(id.slice(2));
    const c = await pub.readContract({ address: LOBBY, abi: lobbyAbi, functionName: 'getChannel', args: [BigInt(n)] });
    return { kind: 'lobby', channel: n, name: c.name };
  }
  if (/^c-0x[0-9a-fA-F]{40}$/.test(id)) {
    const crew = id.slice(2).toLowerCase() as Address;
    const all = await pub.readContract({ address: DEPLOYMENT.factory as Address, abi: factoryAbi, functionName: 'allCrews' });
    if (!all.some(k => k.toLowerCase() === crew)) throw Error('Not a Kumi crew vault.');
    const name = await pub.readContract({ address: crew, abi: crewAbi, functionName: 'name' });
    return { kind: 'crew', crew, name };
  }
  throw Error('chat must be l-<channel> or c-<crew vault>.');
}
