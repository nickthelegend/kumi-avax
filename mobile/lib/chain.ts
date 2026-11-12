import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createPublicClient, createWalletClient, type Abi, type Address, type Hex } from 'viem';
import { DEPLOYMENT, MARKETS, fuji, fujiTransport, perpsAbi, usdcAbi, crewAbi, lobbyAbi } from '@kumi-avax/sdk';
import { signer } from './wallet';

export const PERPS = DEPLOYMENT.perps as Address;
export const USDC = DEPLOYMENT.usdc as Address;
export const LOBBY = DEPLOYMENT.lobby as Address;
export const FACTORY = DEPLOYMENT.factory as Address;
export const FAUCET_URL = 'https://core.app/tools/testnet-faucet/?subnet=c&token=c';

export const pub = createPublicClient({
  chain: { ...fuji, contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } },
  transport: fujiTransport(),
  batch: { multicall: { wait: 16 } },
});

const NAMES = DEPLOYMENT.names as Record<string, string>;
const TEST = new Set<string>(DEPLOYMENT.testAccounts as readonly string[]);
export const isTestAccount = (a?: string | null) => !!a && TEST.has(a.toLowerCase());
export function nameOf(a: string | undefined | null, me?: string | null): string {
  if (!a) return '';
  if (me && a.toLowerCase() === me.toLowerCase()) return 'You';
  return NAMES[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Polls `fn` every `ms` while the app is in the foreground; keeps the last good value when a refresh fails. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[], ms = 5000) {
  const [state, set] = useState<{ data?: T; error?: string; at?: number }>({});
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const key = JSON.stringify(deps, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  const lastKey = useRef(key);
  useEffect(() => {
    alive.current = true;
    // New inputs (another market, another chat): never show the previous one's data under the new label.
    if (lastKey.current !== key) { lastKey.current = key; set({}); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const data = await fn();
        if (alive.current) set({ data, at: Date.now() });
      } catch (e) {
        if (alive.current) set(s => ({ ...s, error: readable(e) }));
      }
      if (alive.current && ms > 0) timer = setTimeout(run, AppState.currentState === 'active' || AppState.currentState == null ? ms : ms * 6);
    };
    void run();
    return () => { alive.current = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick(t => t + 1) };
}

/** Turns viem / contract errors into one sentence a person can read (same wording as the web app). */
export function readable(e: unknown): string {
  const any = e as { shortMessage?: string; message?: string; walk?: (f: (x: unknown) => boolean) => unknown };
  const named = (any?.walk?.((x: any) => !!x?.data?.errorName) as any)?.data;
  if (named?.errorName) return explainError(named.errorName, named.args ?? []);
  const msg = any?.shortMessage ?? any?.message ?? String(e);
  if (/insufficient funds|gas required exceeds/i.test(msg)) return 'This wallet has no Fuji AVAX for gas yet. Get a little from the faucet (Wallet tab), then try again.';
  if (/fetch|network|timeout|HTTP request failed|Network request failed/i.test(msg)) return 'The Fuji RPC did not answer. Check your connection; retrying shortly.';
  return msg.split('\n')[0]!;
}

const usd = (v: unknown) => `$${(Number(v as bigint) / 1e6).toFixed(2)}`;
export function explainError(name: string, args: readonly unknown[]): string {
  switch (name) {
    case 'StaleOracle': return `The Chainlink price for ${MARKETS[Number(args[0])]?.pair ?? 'this market'} is older than the venue accepts, so trading is paused until it updates.`;
    case 'BadOraclePrice': return 'The Chainlink feed returned a non-positive price; the venue refuses to trade on it.';
    case 'InsufficientMargin': return `Not enough margin: equity ${usd(args[0])}, required ${usd(args[1])}.`;
    case 'InsufficientCollateral': return 'Not enough free margin on the venue for that.';
    case 'CrewLeverageExceeded': return `That would take the crew past its leverage cap (${usd(args[0])} of positions, cap ${usd(args[1])}).`;
    case 'LeverageAbovePolicy': return `This crew allows at most ${args[1]}x.`;
    case 'ThresholdNotMet': return 'Not enough yes votes yet.';
    case 'AlreadyVoted': return 'You already voted on this.';
    case 'VotingClosed': return 'Voting on this pitch has closed.';
    case 'AlreadyExecuted': return 'This pitch already executed.';
    case 'NotMember': return 'Only crew members can do that.';
    case 'NoShares': return 'Chip in first: votes are weighted by your shares.';
    case 'NothingToClose': return 'Nothing filled: the order book had no liquidity inside the slippage limit.';
    case 'CaptainLimit': return 'Outside the captain limits (leverage, size or trades per day).';
    case 'FaucetCooldown': return 'The faucet gives 1,000 tUSDC once a day. Come back tomorrow.';
    case 'InsufficientBalance': return 'Not enough tUSDC in this wallet. Tap Get test USDC on the Wallet tab.';
    case 'OutsideBand': return 'That price is too far from the Chainlink price (orders must sit within 5%).';
    case 'BadTick': return 'Price must be on the market tick.';
    case 'BadLot': return 'Size must be a multiple of the lot.';
    case 'WouldCross': return 'A post-only order would have crossed the book.';
    case 'NotInChannel': return 'Join the chat first.';
    case 'AlreadyInChannel': return 'You are already in this chat.';
    case 'NoMatchingPosition': return 'The venue shows no position on that side yet, so the copy was not recorded.';
    case 'AlreadyCopied': return 'You already copied this call.';
    case 'OwnCall': return 'That is your own call.';
    case 'BadText': return 'Messages are 1 to 280 characters.';
    default: return `The contract refused: ${name}.`;
  }
}

export type Sent = { hash: Hex; label: string };
/** Signs on this phone and sends one contract call to Fuji; waits for the receipt and fails loudly on a revert. */
export async function send(address: Address, abi: Abi, functionName: string, args: unknown[] = [], label = functionName): Promise<Sent> {
  const account = signer();
  let last: unknown;
  // Two public RPCs sit behind the fallback transport; right after a receipt the other can lag a block, so a
  // dependent simulation (allowance, nonce) may see stale state once. Retry twice, then fail loudly.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { request } = await pub.simulateContract({ account, address, abi, functionName, args } as any);
      const gas = await pub.estimateContractGas({ account, address, abi, functionName, args } as any);
      const wallet = createWalletClient({ account, chain: fuji, transport: fujiTransport() });
      const hash = await wallet.writeContract({ ...(request as any), account, chain: fuji, gas: (gas * 13n) / 10n });
      const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 400, timeout: 90_000 });
      if (r.status !== 'success') throw Error(`Transaction reverted on Fuji: ${hash}`);
      return { hash, label };
    } catch (e) {
      last = e;
      const msg = readable(e);
      // A margin deposit or eERC deposit the other RPC has not seen yet reads as "not enough" for a moment too.
      const transient = /InsufficientAllowance|nonce|RPC did not answer|Not enough margin|Not enough free margin/i.test(msg + String((e as Error)?.message));
      if (!transient) break;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw Error(readable(last));
}

// ---------------------------------------------------------------- reads
export async function readAccount(me: Address) {
  const [avax, usdc, allowance, collateral, health, positions] = await Promise.all([
    pub.getBalance({ address: me }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [me] }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, PERPS] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'collateral', args: [me] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'health', args: [me] }).catch(() => null),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'positionsOf', args: [me] }).catch(() => [] as const),
  ]);
  const ids = (await Promise.all(MARKETS.map(m => pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'openOrders', args: [me, m.id, 20n] })))).flat();
  const orders = await Promise.all(ids.map(async id => {
    const o = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'orders', args: [id] });
    return { id, market: Number(o[1]), isBuy: o[2], price: o[3], ts: Number(o[4]), size: o[5] };
  }));
  return { avax, usdc, allowance, collateral, equity: health?.[0] ?? collateral, initialReq: health?.[1] ?? 0n, positions: [...positions], orders };
}
export type AccountState = Awaited<ReturnType<typeof readAccount>>;

export const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;

export async function readBook(market: number, levels = 10) {
  const [bids, asks, trades, info, oracle] = await Promise.all([
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'depth', args: [market, true, BigInt(levels)] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'depth', args: [market, false, BigInt(levels)] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'recentTrades', args: [market, 64n] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [market] }),
    pub.readContract({ address: MARKETS[market]!.feed as Address, abi: feedAbi, functionName: 'latestRoundData' }),
  ]);
  const side = (d: readonly [readonly bigint[], readonly bigint[], readonly number[]]) => d[0].map((p, i) => ({ price: p, size: d[1][i]!, count: d[2][i]! }));
  return {
    bids: side(bids), asks: side(asks),
    trades: trades.map(t => ({ price: t.price, size: t.size, takerBuy: t.takerBuy, ts: Number(t.ts) })),
    bestBid: info.bestBid, bestAsk: info.bestAsk, lastPrice: info.lastPrice, tradeCount: info.tradeCount, openInterest: info.openInterest,
    oracle: oracle[1], oracleAt: Number(oracle[3]), stale: Date.now() / 1000 > Number(oracle[3]) + Number(info.maxAge),
  };
}
export type Book = Awaited<ReturnType<typeof readBook>>;

export { perpsAbi, usdcAbi, crewAbi, lobbyAbi };
