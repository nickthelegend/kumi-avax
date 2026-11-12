/**
 * Lobby (public chats) and personal trades for the web app, through the same signer as the crew room. Reads use the
 * shared SDK chat client, so web and phone see the same on-chain messages.
 */
import type { Abi, Address, Hex } from 'viem';
import { DEPLOYMENT, MARKETS, encodeOrder, initialMargin, lobbyAbi, perpsAbi, sizeFor, usdcAbi, type ChatItem } from '@kumi-avax/sdk';
import { PERPS, USDC, pub } from './chain';
import { write } from './signer';

export const LOBBY = DEPLOYMENT.lobby as Address;
const MAX = 2n ** 256n - 1n;
type Step = (s: string) => void;

export async function ensureMargin(me: Address, need: bigint, step: Step) {
  const [eq, im] = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'health', args: [me] }).catch(() => [0n, 0n, 0n] as const);
  const free = eq - BigInt(im);
  if (free >= need) return;
  const gap = need - (free > 0n ? free : 0n);
  const [bal, allowance] = await Promise.all([
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [me] }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, PERPS] }),
  ]);
  if (bal < gap) throw Error(`You need ${(Number(gap) / 1e6).toFixed(2)} tUSDC of margin and hold ${(Number(bal) / 1e6).toFixed(2)}. Use the 1,000 tUSDC faucet in the chip-in sheet of any crew, or TestUSDC.faucet().`);
  if (allowance < gap) { step('Approving tUSDC'); await write(USDC, usdcAbi as Abi, 'approve', [PERPS, MAX]); }
  step('Depositing margin');
  await write(PERPS, perpsAbi as Abi, 'deposit', [gap]);
}

/** Copies a lobby call from the connected wallet: margin, an IOC order on the book, then KumiLobby.copy. */
export async function copyCall(me: Address, channel: number, call: ChatItem, margin: bigint, step: Step): Promise<Hex> {
  const m = MARKETS[call.market ?? 0]!;
  const [info, [oracle]] = await Promise.all([
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [m.id] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'oraclePrice', args: [m.id] }),
  ]);
  const touch = call.isLong ? info.bestAsk : info.bestBid;
  const size = sizeFor(m, margin, call.leverage ?? 1, touch || oracle);
  if (size === 0n) throw Error('That margin rounds to a zero-size order.');
  const im = initialMargin(size, touch || oracle);
  // the chosen margin, and never less than initial margin + 20% (fills mark at Chainlink)
  await ensureMargin(me, margin > im + im / 5n ? margin : im + im / 5n, step);
  step('Placing the order');
  const order = await write(PERPS, perpsAbi as Abi, 'placeOrder', [...encodeOrder({ market: m.id, isBuy: !!call.isLong, kind: 'market', size }, { touch, oracle })]);
  step('Recording the copy');
  await write(LOBBY, lobbyAbi as Abi, 'copy', [BigInt(channel), BigInt(call.index), order]);
  return order;
}

export const joinChannel = (id: number) => write(LOBBY, lobbyAbi as Abi, 'join', [BigInt(id)]);
export const sayInChannel = (id: number, text: string) => write(LOBBY, lobbyAbi as Abi, 'say', [BigInt(id), text]);
export const callInChannel = (id: number, market: number, isLong: boolean, leverage: number, margin: bigint, note: string) =>
  write(LOBBY, lobbyAbi as Abi, 'call', [BigInt(id), market, isLong, leverage, margin, note]);
