/**
 * Kumi v2.2 on Fuji: more real trade calls and copies from Kumi's test accounts, so the caller leaderboard has a
 * record to rank. Each call stores Chainlink's price on-chain when it is made; each copy is a real IOC order on
 * KumiPerps that KumiLobby checks before it posts. `close` steps close a copied position on the book (realised PnL).
 *
 *   node fuji/seed-v22.ts           run every step not yet done (idempotent by label, recorded under "seedV22")
 *   node fuji/seed-v22.ts close     also close the copies listed in CLOSES
 */
import type { Account, Hex } from 'viem';
import { MARKETS, lobbyAbi, perpsAbi, sizeFor, marketLimit, FLAG } from '@kumi-avax/sdk';
import { account } from './env.ts';
import { load, pub, save, send } from './tx.ts';

const SECTION = 'seedV22';
const d0 = load();
const done = new Set<string>((d0[SECTION] ?? []).map((t: { label: string }) => t.label));
const who = {
  mika: account('KUMI_MIKA_KEY'), bo: account('KUMI_BO_KEY'), ren: account('KUMI_REN_KEY'),
  jun: account('KUMI_JUN_KEY'), sora: account('KUMI_SORA_KEY'), tae: account('KUMI_TAE_KEY'), lia: account('KUMI_LIA_KEY'),
};
type Name = keyof typeof who;
const USD = (n: number) => BigInt(Math.round(n * 1e6));
const lobby = d0.contracts.lobby as `0x${string}`;
const perps = d0.contracts.perps as `0x${string}`;
const chId = d0.lobbyChannels as Record<string, number>;

async function step(label: string, a: Account, to: `0x${string}`, abi: any, fn: string, args: unknown[] = []) {
  if (done.has(label)) return null;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await send(a, label, to, abi, fn, args, SECTION);
      done.add(label);
      return r;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`retry ${label} (${(e as Error).message.split('\n')[0]})`);
      await new Promise(r => setTimeout(r, 2500 * attempt));
    }
  }
}
const isMember = (slug: string, n: Name) => pub.readContract({ address: lobby, abi: lobbyAbi, functionName: 'isMember', args: [BigInt(chId[slug]!), who[n].address] });
async function join(slug: string, n: Name) { if (!(await isMember(slug, n))) await step(`join_${slug}_${n}`, who[n], lobby, lobbyAbi, 'join', [BigInt(chId[slug]!)]); }
const lsay = (slug: string, n: Name, i: number, text: string) => step(`lsay_${slug}_${n}_${i}`, who[n], lobby, lobbyAbi, 'say', [BigInt(chId[slug]!), text]);

async function lcall(slug: string, n: Name, label: string, market: number, isLong: boolean, lev: number, margin: number, note: string): Promise<number> {
  const key = `lcall_${slug}_${label}`;
  const x = load();
  if (x.lobbyCalls?.[key] !== undefined) return x.lobbyCalls[key];
  const before = Number(await pub.readContract({ address: lobby, abi: lobbyAbi, functionName: 'messageCount', args: [BigInt(chId[slug]!)] }));
  await step(key, who[n], lobby, lobbyAbi, 'call', [BigInt(chId[slug]!), market, isLong, lev, USD(margin), note]);
  const y = load(); (y.lobbyCalls ??= {})[key] = before; save(y);
  return before;
}

async function copyCall(slug: string, n: Name, label: string, callIndex: number, market: number, isLong: boolean, lev: number, margin: number) {
  const key = `copy_${slug}_${label}_${n}`;
  if (done.has(key)) return;
  const m = MARKETS[market]!;
  await step(`margin_${slug}_${label}_${n}`, who[n], perps, perpsAbi, 'deposit', [USD(margin * 1.25)]);
  const [info, [oracle]] = await Promise.all([
    pub.readContract({ address: perps, abi: perpsAbi, functionName: 'getMarket', args: [market] }),
    pub.readContract({ address: perps, abi: perpsAbi, functionName: 'oraclePrice', args: [market] }),
  ]);
  const touch = isLong ? info.bestAsk : info.bestBid;
  const size = sizeFor(m, USD(margin), lev, touch || oracle);
  const limit = marketLimit(m, isLong, touch, oracle, 50);
  const r = await step(`order_${slug}_${label}_${n}`, who[n], perps, perpsAbi, 'placeOrder', [market, isLong, limit, size, FLAG.IOC]);
  const hash = (r?.transactionHash ?? (load()[SECTION] as any[]).find(t => t.label === `order_${slug}_${label}_${n}`)?.hash) as Hex;
  await step(key, who[n], lobby, lobbyAbi, 'copy', [BigInt(chId[slug]!), BigInt(callIndex), hash]);
}

/** Closes the account's whole position in a market with a reduce-only IOC on the book. */
async function close(n: Name, market: number, label: string) {
  const key = `close_${label}_${n}`;
  if (done.has(key)) return;
  const [size] = await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'positions', args: [who[n].address, market] });
  if (size === 0n) { console.log(`${n} has no position in ${MARKETS[market]!.symbol}`); return; }
  const isBuy = size < 0n;
  const abs = size < 0n ? -size : size;
  const [info, [oracle]] = await Promise.all([
    pub.readContract({ address: perps, abi: perpsAbi, functionName: 'getMarket', args: [market] }),
    pub.readContract({ address: perps, abi: perpsAbi, functionName: 'oraclePrice', args: [market] }),
  ]);
  const limit = marketLimit(MARKETS[market]!, isBuy, isBuy ? info.bestAsk : info.bestBid, oracle, 50);
  await step(key, who[n], perps, perpsAbi, 'placeOrder', [market, isBuy, limit, abs, FLAG.IOC | FLAG.REDUCE_ONLY]);
}

// ---------------------------------------------------------------- joins
await join('avaxpit', 'tae'); await join('avaxpit', 'lia');

// ---------------------------------------------------------------- AVAX pit
await lsay('avaxpit', 'jun', 2, 'AVAX lost 8.40 on the 1h. Chainlink shows it too');
const junShort = await lcall('avaxpit', 'jun', 'short1', 0, false, 2, 40, 'lost 8.40, short the retest from below');
await copyCall('avaxpit', 'lia', 'short1', junShort, 0, false, 2, 30);
// First run: a label clash ('long1' was mika's v2 call) made bo copy mika's call #7 instead (copy_avaxpit_long1_bo,
// a real copy). tae's call then went out under v22long1, copied by sora.
const taeLong = await lcall('avaxpit', 'tae', 'v22long1', 0, true, 2, 30, '8.30 held twice on the 15m');
await copyCall('avaxpit', 'sora', 'v22long1', taeLong, 0, true, 2, 25);
await lsay('avaxpit', 'lia', 1, 'took jun\'s short with 30. two calls, two sides, the board will tell');

// ---------------------------------------------------------------- BTC desk
const taeBtc = await lcall('btcdesk', 'tae', 'short1', 1, false, 2, 50, 'lower high under 74k');
await copyCall('btcdesk', 'mika', 'short1', taeBtc, 1, false, 2, 40);
const boBtc = await lcall('btcdesk', 'bo', 'v22long1', 1, true, 1, 40, 'slow bid near 72.9k, 1x');

// ---------------------------------------------------------------- New to Kumi
const soraLong = await lcall('newbies', 'sora', 'long1', 0, true, 1, 20, 'small first trade, 1x');
await copyCall('newbies', 'jun', 'long1', soraLong, 0, true, 1, 20);
const renShort = await lcall('newbies', 'ren', 'short1', 0, false, 3, 25, 'fading the bounce');
await lsay('newbies', 'tae', 2, 'the Top tab ranks callers from these calls, all on-chain');
void boBtc; void renShort;

// ---------------------------------------------------------------- closes (realised PnL), only when asked
if (process.argv.includes('close')) {
  await close('ren', 0, 'avaxpit_long1'); // ren's copy of mika's AVAX long (v2)
}
console.log('seedV22 steps', load()[SECTION]?.length ?? 0);
