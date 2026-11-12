import { useEffect, useRef, useState } from 'react';
import { createPublicClient, parseAbiItem, type Address } from 'viem';
import { crewAbi, perpsAbi, usdcAbi, factoryAbi, fuji, fujiTransport, DEPLOYMENT, MARKETS } from '@kumi-avax/sdk';

export const PERPS = DEPLOYMENT.perps as Address;
export const USDC = DEPLOYMENT.usdc as Address;
export const FACTORY = DEPLOYMENT.factory as Address;

export const pub = createPublicClient({
  chain: { ...fuji, contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } },
  transport: fujiTransport(),
  batch: { multicall: { wait: 16 } },
});

/** Polls `fn` every `ms`; keeps the last good value when a refresh fails, and says so. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[], ms = 4000) {
  const [state, set] = useState<{ data?: T; error?: string; at?: number }>({});
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const data = await fn();
        if (alive.current) set({ data, at: Date.now() });
      } catch (e) {
        if (alive.current) set(s => ({ ...s, error: readable(e) }));
      }
      if (alive.current && ms > 0) timer = setTimeout(run, document.hidden ? ms * 4 : ms);
    };
    void run();
    return () => { alive.current = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick(t => t + 1) };
}

/** Turns viem / contract errors into one sentence a person can read. */
export function readable(e: unknown): string {
  const any = e as { shortMessage?: string; message?: string; cause?: { data?: { errorName?: string; args?: unknown[] } }; walk?: (f: (x: unknown) => boolean) => unknown };
  const named = (any.walk?.((x: any) => !!x?.data?.errorName) as any)?.data;
  if (named?.errorName) return explainError(named.errorName, named.args ?? []);
  const msg = any.shortMessage ?? any.message ?? String(e);
  if (/User rejected|denied/i.test(msg)) return 'You cancelled the signature.';
  if (/fetch|network|timeout|HTTP request failed/i.test(msg)) return 'The Fuji RPC did not answer. Retrying shortly.';
  return msg.split('\n')[0]!;
}

const usd = (v: unknown) => `$${(Number(v as bigint) / 1e6).toFixed(2)}`;
export function explainError(name: string, args: readonly unknown[]): string {
  switch (name) {
    case 'StaleOracle': return `The Chainlink price for ${MARKETS[Number(args[0])]?.pair ?? 'this market'} is older than the venue accepts, so trading is paused until it updates.`;
    case 'BadOraclePrice': return 'The Chainlink feed returned a non-positive price; the venue refuses to trade on it.';
    case 'InsufficientMargin': return `Not enough margin: equity ${usd(args[0])}, required ${usd(args[1])}.`;
    case 'CrewLeverageExceeded': return `That would take the crew past its leverage cap (${usd(args[0])} of positions, cap ${usd(args[1])}).`;
    case 'LeverageAbovePolicy': return `This crew allows at most ${args[1]}x.`;
    case 'ThresholdNotMet': return 'Not enough yes votes yet.';
    case 'AlreadyVoted': return 'You already voted on this.';
    case 'VotingClosed': return 'Voting on this pitch has closed.';
    case 'AlreadyExecuted': return 'This pitch already executed.';
    case 'NotMember': return 'Only crew members can do that.';
    case 'NoShares': return 'Chip in first: votes are weighted by your shares.';
    case 'NothingToClose': return 'Nothing filled: the order book had no liquidity inside the slippage limit.';
    case 'ExitCostExceedsShare': return 'Closing your slice would cost more than your share.';
    case 'CaptainLimit': return 'Outside the captain limits (leverage, size or trades per day).';
    case 'NotCaptain': return 'Only the captain can trade without a vote.';
    case 'FaucetCooldown': return 'The faucet gives 1,000 tUSDC once a day.';
    case 'OutsideBand': return 'That price is too far from the Chainlink price.';
    default: return `The contract refused: ${name}.`;
  }
}

// ------------------------------------------------------------------ reads
export type MarketState = {
  id: number; symbol: string; pair: string; oracle: bigint; oracleAt: number; stale: boolean;
  bestBid: bigint; bestAsk: bigint; lastPrice: bigint; tradeCount: bigint; openInterest: bigint;
  premium: bigint; hourlyRate: bigint; imBps: number; mmBps: number; bandBps: number; maxAge: number;
};

export async function readMarkets(): Promise<MarketState[]> {
  return Promise.all(MARKETS.map(async m => {
    const [info, feed] = await Promise.all([
      pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [m.id] }),
      pub.readContract({ address: m.feed as Address, abi: feedAbi, functionName: 'latestRoundData' }),
    ]);
    const oracleAt = Number(feed[3]);
    const stale = Date.now() / 1000 > oracleAt + info.maxAge;
    let premium = 0n, hourlyRate = 0n;
    if (!stale) {
      const f = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'fundingInfo', args: [m.id] });
      premium = f[0]; hourlyRate = f[1];
    }
    return {
      id: m.id, symbol: m.symbol, pair: m.pair, oracle: feed[1], oracleAt, stale,
      bestBid: info.bestBid, bestAsk: info.bestAsk, lastPrice: info.lastPrice, tradeCount: info.tradeCount,
      openInterest: info.openInterest, premium, hourlyRate, imBps: info.imBps, mmBps: info.mmBps, bandBps: info.bandBps, maxAge: info.maxAge,
    };
  }));
}

export const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;

export async function readBook(market: number, levels = 12) {
  const [bids, asks, trades] = await Promise.all([
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'depth', args: [market, true, BigInt(levels)] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'depth', args: [market, false, BigInt(levels)] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'recentTrades', args: [market, 40n] }),
  ]);
  const side = (d: readonly [readonly bigint[], readonly bigint[], readonly number[]]) => d[0].map((p, i) => ({ price: p, size: d[1][i]!, count: d[2][i]! }));
  return { bids: side(bids), asks: side(asks), trades: trades.map(t => ({ price: t.price, size: t.size, takerBuy: t.takerBuy, ts: Number(t.ts) })) };
}

export type Proposal = Awaited<ReturnType<typeof readProposal>>;
export async function readProposal(crew: Address, id: number, me?: Address) {
  const [p, tally, voters] = await Promise.all([
    pub.readContract({ address: crew, abi: crewAbi, functionName: 'getProposal', args: [BigInt(id)] }),
    pub.readContract({ address: crew, abi: crewAbi, functionName: 'tally', args: [BigInt(id)] }),
    pub.readContract({ address: crew, abi: crewAbi, functionName: 'votersOf', args: [BigInt(id)] }),
  ]);
  const votes = await Promise.all(voters.map(v => pub.readContract({ address: crew, abi: crewAbi, functionName: 'voteOf', args: [BigInt(id), v] })));
  return {
    id, ...p, yesShares: tally[0], noShares: tally[1], needed: tally[2],
    votes: voters.map((v, i) => ({ voter: v, support: votes[i]! > 0 })),
    myVote: me ? (votes[voters.findIndex(v => v.toLowerCase() === me.toLowerCase())] ?? 0) : 0,
  };
}

export type CrewState = Awaited<ReturnType<typeof readCrew>>;
export async function readCrew(crew: Address, me?: Address) {
  const c = { address: crew, abi: crewAbi } as const;
  const [name, members, totalShares, nav, policy, captain, feedLength, proposalCount, totalDeposited, totalWithdrawn, positions, collateral] = await Promise.all([
    pub.readContract({ ...c, functionName: 'name' }),
    pub.readContract({ ...c, functionName: 'members' }),
    pub.readContract({ ...c, functionName: 'totalShares' }),
    pub.readContract({ ...c, functionName: 'nav' }),
    pub.readContract({ ...c, functionName: 'policy' }),
    pub.readContract({ ...c, functionName: 'captain' }),
    pub.readContract({ ...c, functionName: 'feedLength' }),
    pub.readContract({ ...c, functionName: 'proposalCount' }),
    pub.readContract({ ...c, functionName: 'totalDeposited' }),
    pub.readContract({ ...c, functionName: 'totalWithdrawn' }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'positionsOf', args: [crew] }).catch(() => null),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'collateral', args: [crew] }),
  ]);
  const shares = await Promise.all(members.map(m => pub.readContract({ ...c, functionName: 'shares', args: [m] })));
  const n = Number(feedLength);
  const from = Math.max(0, n - 120);
  const feed = n ? await pub.readContract({ ...c, functionName: 'feedSlice', args: [BigInt(from), 120n] }) : [];
  const [usdcBal, allowance, myShares, isMember] = me ? await Promise.all([
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [me] }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'allowance', args: [me, crew] }),
    pub.readContract({ ...c, functionName: 'shares', args: [me] }),
    pub.readContract({ ...c, functionName: 'isMember', args: [me] }),
  ]) : [0n, 0n, 0n, false];
  return {
    address: crew, name, captain, totalShares, nav, collateral, totalDeposited, totalWithdrawn,
    policy: { thresholdBps: policy[0], votingPeriod: policy[1], maxLeverage: policy[2], maxSlippageBps: policy[3], captainMaxLeverage: policy[4], captainMaxBps: policy[5], captainTradesPerDay: policy[6] },
    members: members.map((m, i) => ({ address: m, shares: shares[i]! })),
    positions: positions ?? [], positionsError: positions === null,
    feed: feed.map((f, i) => ({ index: from + i, kind: f.kind, who: f.who, ts: Number(f.ts), block: f.blockNumber, ref: f.ref, amount: f.amount, text: f.text })),
    proposalCount: Number(proposalCount),
    me: me ? { address: me, usdc: usdcBal, allowance, shares: myShares, isMember } : null,
    readAt: Date.now(),
  };
}

export async function readCrews(): Promise<{ address: Address; name: string; nav: bigint; members: number; totalShares: bigint }[]> {
  const list = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'allCrews' });
  return Promise.all(list.map(async a => {
    const [name, nav, members, totalShares] = await Promise.all([
      pub.readContract({ address: a, abi: crewAbi, functionName: 'name' }),
      pub.readContract({ address: a, abi: crewAbi, functionName: 'nav' }).catch(() => 0n),
      pub.readContract({ address: a, abi: crewAbi, functionName: 'members' }),
      pub.readContract({ address: a, abi: crewAbi, functionName: 'totalShares' }),
    ]);
    return { address: a, name, nav, members: members.length, totalShares };
  }));
}

/** The tx hash of a feed entry: one getLogs on the block the entry recorded. Cached. */
const FEED_EVENT = parseAbiItem('event Feed(uint256 indexed index, uint8 indexed kind, address indexed who, uint32 ref, int256 amount)');
const txCache = new Map<string, Promise<string | undefined>>();
let queue: Promise<unknown> = Promise.resolve();
export function feedTx(crew: Address, index: number, block: bigint): Promise<string | undefined> {
  const k = `${crew}:${index}`;
  const hit = txCache.get(k);
  if (hit) return hit;
  // One getLogs at a time, so a long chat doesn't trip the public RPC's rate limit.
  const p = queue.then(async () => {
    const logs = await pub.getLogs({ address: crew, event: FEED_EVENT, args: { index: BigInt(index) }, fromBlock: block, toBlock: block });
    return logs[0]?.transactionHash as string | undefined;
  });
  queue = p.catch(() => undefined);
  txCache.set(k, p.then(h => { if (!h) txCache.delete(k); return h; }, () => { txCache.delete(k); return undefined; }));
  return txCache.get(k)!;
}

/** Recent fills by any account, from the venue's Filled events (last ~2k blocks). */
const FILLED = parseAbiItem('event Filled(uint8 indexed market, uint64 indexed makerOrderId, address indexed maker, address taker, bool takerBuy, uint64 price, uint128 size)');
export async function recentFills(blocks = 2000n) {
  const head = await pub.getBlockNumber();
  const start = head > blocks ? head - blocks : 0n;
  const out: { market?: number; makerOrderId?: bigint; maker?: Address; taker?: Address; takerBuy?: boolean; price?: bigint; size?: bigint; hash: string; block: bigint }[] = [];
  // Public Fuji RPCs cap eth_getLogs at 2,048 blocks: walk the range in chunks, oldest first.
  for (let from = start; from <= head; from += 2000n) {
    const to = from + 1999n > head ? head : from + 1999n;
    const logs = await pub.getLogs({ address: PERPS, event: FILLED, fromBlock: from, toBlock: to });
    for (const l of logs) out.push({ ...l.args, hash: l.transactionHash, block: l.blockNumber });
  }
  return out;
}

/** The newest `want` fills, walking back from the head in 2,000-block chunks (public RPC cap) up to `maxBlocks`. */
export async function latestFills(want = 6, maxBlocks = 43_200n) {
  const head = await pub.getBlockNumber();
  const floor = head > maxBlocks ? head - maxBlocks : 0n;
  const out: Awaited<ReturnType<typeof recentFills>> = [];
  for (let to = head; to > floor && out.length < want; to -= 2000n) {
    const from = to - 1999n > floor ? to - 1999n : floor;
    const logs = await pub.getLogs({ address: PERPS, event: FILLED, fromBlock: from, toBlock: to });
    for (const l of logs.reverse()) out.push({ ...l.args, hash: l.transactionHash, block: l.blockNumber });
  }
  return out.slice(0, want);
}
