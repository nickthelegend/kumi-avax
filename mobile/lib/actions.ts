/**
 * Everything the phone signs. Each action is one or more real Fuji transactions signed with this phone's key
 * (lib/wallet.ts) and sent through lib/chain.ts `send`. `step` reports progress ("Approving tUSDC", "Placing the
 * order") so the UI can show which transaction is in flight.
 */
import type { Address, Hex } from 'viem';
import { Kind, MARKETS, describe, encodeOrder, initialMargin, sizeFor, type Command, type ChatItem } from '@kumi-avax/sdk';
import { LOBBY, PERPS, USDC, crewAbi, lobbyAbi, perpsAbi, pub, send, usdcAbi, type Sent } from './chain';
import { signer } from './wallet';

type Step = (label: string) => void;
const noop: Step = () => {};
const ZERO = '0x0000000000000000000000000000000000000000' as const;
const MAX = 2n ** 256n - 1n;

export const getTestUsdc = () => send(USDC, usdcAbi as any, 'faucet', [], 'Test USDC from the faucet');

/** Makes sure the venue holds at least `need` free margin for this wallet: approve once, then deposit the gap. */
export async function ensureMargin(need: bigint, step: Step = noop): Promise<Sent[]> {
  const me = signer().address;
  const out: Sent[] = [];
  const [eq, initialReq] = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'health', args: [me] }).catch(() => [0n, 0n, 0n] as const);
  const free = eq - BigInt(initialReq);
  if (free >= need) return out;
  const gap = need - (free > 0n ? free : 0n);
  const [bal, allowance] = await Promise.all([
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [me] }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, PERPS] }),
  ]);
  if (bal < gap) throw Error(`You need ${(Number(gap) / 1e6).toFixed(2)} tUSDC of margin and the wallet holds ${(Number(bal) / 1e6).toFixed(2)}. Tap Get test USDC on the Wallet tab.`);
  if (allowance < gap) { step('Approving tUSDC for KumiPerps'); out.push(await send(USDC, usdcAbi as any, 'approve', [PERPS, MAX], 'Approve tUSDC')); }
  step(`Depositing ${(Number(gap) / 1e6).toFixed(2)} tUSDC margin`);
  out.push(await send(PERPS, perpsAbi as any, 'deposit', [gap], 'Deposit margin'));
  return out;
}

async function touch(market: number, isBuy: boolean) {
  const [info, oracle] = await Promise.all([
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [market] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'oraclePrice', args: [market] }),
  ]);
  return { touch: isBuy ? info.bestAsk : info.bestBid, oracle: oracle[0] };
}

export type TicketInput = { market: number; isBuy: boolean; kind: 'market' | 'limit'; price?: bigint; margin: bigint; leverage: number; reduceOnly?: boolean; postOnly?: boolean };

/** Places a ticket from the Market tab: margin in, then one placeOrder, encoded against the live book. */
export async function placeTicket(t: TicketInput, step: Step = noop): Promise<{ txs: Sent[]; size: bigint }> {
  const m = MARKETS[t.market]!;
  const ctx = await touch(t.market, t.isBuy);
  const ref = t.kind === 'limit' && t.price ? t.price : ctx.touch || ctx.oracle;
  const size = sizeFor(m, t.margin, t.leverage, ref);
  if (size === 0n) throw Error('That size rounds to zero on this market. Add margin or leverage.');
  const txs: Sent[] = [];
  // Free margin for the order: what the user chose, and never less than the venue's initial margin plus 20%
  // (fills mark at Chainlink, so a book a little off the oracle can take a few % of equity on the fill).
  const im = initialMargin(size, ref);
  const need = t.margin > im + im / 5n ? t.margin : im + im / 5n;
  if (!t.reduceOnly) txs.push(...(await ensureMargin(need, step)));
  const args = encodeOrder({ market: t.market, isBuy: t.isBuy, kind: t.kind, price: t.price, size, reduceOnly: t.reduceOnly, postOnly: t.postOnly }, ctx);
  step(t.kind === 'market' ? 'Placing the market order' : 'Placing the limit order');
  txs.push(await send(PERPS, perpsAbi as any, 'placeOrder', [...args], `${t.isBuy ? 'Buy' : 'Sell'} ${m.symbol}`));
  return { txs, size };
}

/** Closes this wallet's whole position in a market with a reduce-only IOC order. */
export async function closePosition(market: number, size: bigint, step: Step = noop): Promise<Sent> {
  const isBuy = size < 0n;
  const abs = size < 0n ? -size : size;
  const ctx = await touch(market, isBuy);
  const args = encodeOrder({ market, isBuy, kind: 'market', size: abs, reduceOnly: true }, ctx);
  step('Closing on the book');
  return send(PERPS, perpsAbi as any, 'placeOrder', [...args], `Close ${MARKETS[market]!.symbol}`);
}

export const cancelOrder = (id: bigint) => send(PERPS, perpsAbi as any, 'cancelOrder', [id], 'Cancel order');

// ---------------------------------------------------------------- lobby chats
export const joinChannel = (id: number) => send(LOBBY, lobbyAbi as any, 'join', [BigInt(id)], 'Join the chat');
export const leaveChannel = (id: number) => send(LOBBY, lobbyAbi as any, 'leave', [BigInt(id)], 'Leave the chat');
export const sayInChannel = (id: number, text: string) => send(LOBBY, lobbyAbi as any, 'say', [BigInt(id), text], 'Message');
export const callInChannel = (id: number, market: number, isLong: boolean, leverage: number, margin: bigint, note: string) =>
  send(LOBBY, lobbyAbi as any, 'call', [BigInt(id), market, isLong, leverage, margin, note], 'Trade call');

/**
 * Copies a lobby call: margin into KumiPerps, an IOC order on the live book from this wallet, then the lobby's
 * `copy`, which checks the new position on the venue and writes its real size and entry into the chat.
 */
export async function copyCall(channel: number, call: ChatItem, margin: bigint, step: Step = noop): Promise<{ txs: Sent[]; order: Hex }> {
  const market = call.market ?? 0;
  const { txs } = await placeTicket({ market, isBuy: !!call.isLong, kind: 'market', margin, leverage: call.leverage ?? 1 }, step);
  const order = txs[txs.length - 1]!.hash;
  step('Recording the copy in the chat');
  txs.push(await send(LOBBY, lobbyAbi as any, 'copy', [BigInt(channel), BigInt(call.index), order], 'Copy'));
  return { txs, order };
}

// ---------------------------------------------------------------- crew rooms
export const sayInCrew = (crew: Address, text: string) => send(crew, crewAbi as any, 'say', [text], 'Message');
export const voteInCrew = (crew: Address, id: number, yes: boolean) => send(crew, crewAbi as any, 'vote', [BigInt(id), yes], yes ? 'Vote yes' : 'Vote no');

/** Sends a parsed crew command (/long, /short, /close, /invite, /captain) as the matching on-chain pitch. */
export function pitchInCrew(crew: Address, c: Command): Promise<Sent> {
  const abi = crewAbi as any;
  if (c.kind === 'open' && c.captain) return send(crew, abi, 'captainOpen', [c.market, c.isLong, c.leverage, c.sizeBps, describe(c)], 'Captain trade');
  if (c.kind === 'close' && c.captain) return send(crew, abi, 'captainClose', [c.market, describe(c)], 'Captain close');
  if (c.kind === 'open') return send(crew, abi, 'pitch', [Kind.Open, c.market, c.isLong, c.leverage, c.sizeBps, ZERO, describe(c)], 'Pitch');
  if (c.kind === 'close') return send(crew, abi, 'pitch', [Kind.Close, c.market, false, 0, c.sizeBps, ZERO, describe(c)], 'Pitch close');
  if (c.kind === 'invite') return send(crew, abi, 'pitch', [Kind.AddMember, 0, false, 0, 0, c.address, describe(c)], 'Invite');
  return send(crew, abi, 'pitch', [Kind.SetCaptain, 0, false, 0, 0, c.address ?? ZERO, describe(c)], 'Captain');
}

export async function chipIn(crew: Address, amount: bigint, step: Step = noop): Promise<Sent[]> {
  const me = signer().address;
  const out: Sent[] = [];
  const allowance = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, crew] });
  if (allowance < amount) { step('Approving tUSDC for the crew vault'); out.push(await send(USDC, usdcAbi as any, 'approve', [crew, MAX], 'Approve tUSDC')); }
  step('Chipping in');
  out.push(await send(crew, crewAbi as any, 'deposit', [amount], 'Chip in'));
  return out;
}

export const ragequit = (crew: Address, shares: bigint) => send(crew, crewAbi as any, 'ragequit', [shares], 'Ragequit');
