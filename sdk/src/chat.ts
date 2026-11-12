/**
 * The Kumi chat client, shared by the web app and the phone. Every message lives on Fuji:
 *  - crew rooms: KumiCrew's feed (chat, pitches, votes, fills, chip-ins, ragequits), members only;
 *  - lobby channels: KumiLobby (chat, trade calls, verified copies, joins), open to anyone who joins.
 * There is no chat server: a message sent from the phone is a Fuji transaction, and the web reads the same chain.
 */
import type { Address, PublicClient } from 'viem';
import { crewAbi, factoryAbi, lobbyAbi } from './abi.ts';
import { FeedKind } from './enums.ts';
import { MARKETS } from './markets.ts';
import { price as fmtPrice, size as fmtSize, usd as fmtUsd } from './format.ts';

export const LobbyKind = { Chat: 0, Call: 1, Copy: 2, Join: 3, Leave: 4 } as const;

export type ChatKind = 'chat' | 'call' | 'copy' | 'join' | 'leave' | 'pitch' | 'vote-yes' | 'vote-no' | 'executed' | 'failed' | 'deposit' | 'ragequit' | 'captain' | 'member' | 'expired';

export type ChatItem = {
  key: string;
  source: 'lobby' | 'crew';
  index: number;
  kind: ChatKind;
  who: Address;
  ts: number;
  block: bigint;
  text: string;
  ref: number;
  /** crew: tUSDC amount or PnL (1e6); lobby call: suggested margin (1e6) */
  amount: bigint;
  market?: number;
  isLong?: boolean;
  leverage?: number;
  /** lobby call: Chainlink price when called; copy: the copier's entry (1e8) */
  price?: bigint;
  /** lobby copy: the copier's position size on KumiPerps (1e18) */
  size?: bigint;
  /** lobby copy: the copier's order tx */
  orderTx?: `0x${string}`;
};

export type Channel = {
  id: number; name: string; topic: string; creator: Address; market: number; createdAt: number;
  memberCount: number; messageCount: number; joined: boolean;
};

const CREW_KIND: Record<number, ChatKind> = {
  [FeedKind.Chat]: 'chat', [FeedKind.Pitch]: 'pitch', [FeedKind.VoteYes]: 'vote-yes', [FeedKind.VoteNo]: 'vote-no',
  [FeedKind.Executed]: 'executed', [FeedKind.ExecFailed]: 'failed', [FeedKind.Deposit]: 'deposit', [FeedKind.Ragequit]: 'ragequit',
  [FeedKind.CaptainTrade]: 'captain', [FeedKind.MemberAdded]: 'member', [FeedKind.Expired]: 'expired',
};
const LOBBY_KIND: ChatKind[] = ['chat', 'call', 'copy', 'join', 'leave'];

export async function readChannels(client: PublicClient, lobby: Address, me?: Address): Promise<Channel[]> {
  const list = await client.readContract({ address: lobby, abi: lobbyAbi, functionName: 'allChannels' });
  const [counts, mine] = await Promise.all([
    Promise.all(list.map((_, i) => client.readContract({ address: lobby, abi: lobbyAbi, functionName: 'messageCount', args: [BigInt(i)] }))),
    me ? client.readContract({ address: lobby, abi: lobbyAbi, functionName: 'channelsOf', args: [me] }) : Promise.resolve([] as readonly bigint[]),
  ]);
  const joined = new Set(mine.map(Number));
  return list.map((c, i) => ({
    id: i, name: c.name, topic: c.topic, creator: c.creator, market: c.market, createdAt: Number(c.createdAt),
    memberCount: Number(c.memberCount), messageCount: Number(counts[i]), joined: joined.has(i),
  }));
}

/** The last `max` messages of a lobby channel, oldest first. */
export async function readChannelMessages(client: PublicClient, lobby: Address, id: number, max = 80): Promise<ChatItem[]> {
  const n = Number(await client.readContract({ address: lobby, abi: lobbyAbi, functionName: 'messageCount', args: [BigInt(id)] }));
  const from = Math.max(0, n - max);
  if (n === 0) return [];
  const rows = await client.readContract({ address: lobby, abi: lobbyAbi, functionName: 'messageSlice', args: [BigInt(id), BigInt(from), BigInt(max)] });
  return rows.map((m, i) => ({
    key: `lobby:${id}:${from + i}`, source: 'lobby', index: from + i, kind: LOBBY_KIND[m.kind] ?? 'chat', who: m.who, ts: Number(m.ts),
    block: m.blockNumber, text: m.text, ref: Number(m.ref), amount: m.margin, market: m.market, isLong: m.isLong, leverage: m.leverage,
    price: m.price, size: m.size, orderTx: m.orderTx === `0x${'0'.repeat(64)}` ? undefined : m.orderTx,
  }));
}

/** The last `max` entries of a crew's on-chain feed, oldest first. */
export async function readCrewMessages(client: PublicClient, crew: Address, max = 80): Promise<ChatItem[]> {
  const n = Number(await client.readContract({ address: crew, abi: crewAbi, functionName: 'feedLength' }));
  if (n === 0) return [];
  const from = Math.max(0, n - max);
  const rows = await client.readContract({ address: crew, abi: crewAbi, functionName: 'feedSlice', args: [BigInt(from), BigInt(max)] });
  return rows.map((f, i) => ({
    key: `crew:${crew}:${from + i}`, source: 'crew', index: from + i, kind: CREW_KIND[f.kind] ?? 'chat', who: f.who, ts: Number(f.ts),
    block: f.blockNumber, text: f.text, ref: Number(f.ref), amount: f.amount,
  }));
}

export type CrewSummary = { address: Address; name: string; members: Address[]; feedLength: number; nav: bigint; isMember: boolean };

/** Every crew from the factory, with membership for `me`. */
export async function readCrewList(client: PublicClient, factory: Address, me?: Address): Promise<CrewSummary[]> {
  const list = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'allCrews' });
  return Promise.all(list.map(async a => {
    const [name, members, feedLength, nav] = await Promise.all([
      client.readContract({ address: a, abi: crewAbi, functionName: 'name' }),
      client.readContract({ address: a, abi: crewAbi, functionName: 'members' }),
      client.readContract({ address: a, abi: crewAbi, functionName: 'feedLength' }),
      client.readContract({ address: a, abi: crewAbi, functionName: 'nav' }).catch(() => 0n),
    ]);
    return { address: a, name, members: [...members], feedLength: Number(feedLength), nav, isMember: !!me && members.some(m => m.toLowerCase() === me.toLowerCase()) };
  }));
}

/** One-line preview of a message for chat lists and notifications. */
export function preview(m: ChatItem, nameOf: (a: string) => string): string {
  const who = nameOf(m.who);
  const mk = m.market !== undefined ? MARKETS[m.market] : undefined;
  switch (m.kind) {
    case 'chat': return `${who}: ${m.text}`;
    case 'call': return `${who} called ${m.isLong ? 'Long' : 'Short'} ${mk?.symbol ?? '?'} ${m.leverage}x, ${fmtUsd(m.amount, 0)} tUSDC`;
    case 'copy': return `${who} copied: ${m.isLong ? 'long' : 'short'} ${fmtSize(m.size ?? 0n, mk?.sizeDp ?? 2)} ${mk?.symbol ?? ''} at $${fmtPrice(m.price ?? 0n, mk?.priceDp ?? 2)}`;
    case 'join': return `${who} joined`;
    case 'leave': return `${who} left`;
    case 'pitch': return `${who} pitched ${m.text || 'a trade'}`;
    case 'vote-yes': return `${who} voted yes`;
    case 'vote-no': return `${who} voted no`;
    case 'executed': return 'Vote passed, the vault traded';
    case 'failed': return 'A passed vote did not fill';
    case 'deposit': return `${who} chipped in ${fmtUsd(m.amount)} tUSDC`;
    case 'ragequit': return `${who} ragequit with ${fmtUsd(m.amount)} tUSDC`;
    case 'captain': return `Captain ${who} traded`;
    case 'member': return `${who} added a member`;
    case 'expired': return 'A pitch expired';
  }
}

/** Unread = messages after the last one this device has seen, not counting the reader's own. */
export function unreadCount(items: ChatItem[], lastSeen: number, me?: string): number {
  return items.filter(m => m.index > lastSeen && (!me || m.who.toLowerCase() !== me.toLowerCase()) && m.kind !== 'join' && m.kind !== 'leave').length;
}
