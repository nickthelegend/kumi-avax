/**
 * The maker bot: keeps a two-sided ladder on each Fuji market around the Chainlink price so crew trades fill.
 *   node fuji/maker.ts                 quote once (cancel own orders, then place the ladder)
 *   node fuji/maker.ts --skew-bps 80   quote around oracle x (1 + 0.80%): the maker leans the book (demo "price move")
 *   node fuji/maker.ts --loop 120      requote every 120 s until stopped
 *   node fuji/maker.ts --cancel        pull all quotes
 * Every transaction is recorded under "makerTxs" in deployments/fuji.json.
 */
import { MARKETS, perpsAbi, usdcAbi, PX_SIZE } from '@kumi-avax/sdk';
import { account } from './env.ts';
import { load, pub, send } from './tx.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const skewBps = BigInt(arg('--skew-bps') ?? '0');
const loop = Number(arg('--loop') ?? '0');
const only = arg('--market');
const LEVELS = 6;
const HALF_SPREAD_BPS = 5n; // 0.05%
const STEP_BPS = 10n; // 0.10% between levels
const LEVEL_USD = 1_500n * 10n ** 6n;

const { contracts: c } = load();
const perps = c.perps as `0x${string}`;
const maker = account('KUMI_MAKER_KEY');
const rec = (label: string, fn: string, args: unknown[]) => send(maker, label, perps, perpsAbi as any, fn, args, 'makerTxs');

async function ensureMargin() {
  const col = await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'collateral', args: [maker.address] });
  if (col > 0n) return;
  await send(maker, 'maker_approve', c.usdc, usdcAbi as any, 'approve', [perps, 2n ** 256n - 1n], 'makerTxs');
  await rec('maker_deposit', 'deposit', [200_000n * 10n ** 6n]);
}

async function cancelAll(m: number) {
  const ids = await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'openOrders', args: [maker.address, m, 200n] });
  if (ids.length) await rec(`maker_cancel_${MARKETS[m]!.symbol}_${ids.length}`, 'cancelOrders', [ids]);
}

async function quote(m: (typeof MARKETS)[number]) {
  const [o] = await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'oraclePrice', args: [m.id] });
  const mid = o * (10_000n + skewBps) / 10_000n;
  await cancelAll(m.id);
  for (let i = 0; i < LEVELS; i++) {
    const off = HALF_SPREAD_BPS + STEP_BPS * BigInt(i);
    let bid = mid * (10_000n - off) / 10_000n; bid -= bid % m.tick;
    let ask = mid * (10_000n + off) / 10_000n; ask += (m.tick - ask % m.tick) % m.tick;
    for (const [isBuy, px] of [[true, bid], [false, ask]] as const) {
      let size = LEVEL_USD * PX_SIZE / px; size -= size % m.lot;
      await rec(`maker_${m.symbol}_${isBuy ? 'bid' : 'ask'}_${i + 1}`, 'placeOrder', [m.id, isBuy, px, size, 4]); // POST_ONLY
    }
  }
  console.log(`${m.pair}: oracle ${Number(o) / 1e8}, quoted around ${Number(mid) / 1e8} (skew ${skewBps} bps)`);
}

await ensureMargin();
const markets = MARKETS.filter(m => !only || m.symbol === only.toUpperCase());
if (process.argv.includes('--cancel')) {
  for (const m of markets) await cancelAll(m.id);
} else {
  do {
    for (const m of markets) await quote(m);
    if (loop) await new Promise(r => setTimeout(r, loop * 1000));
  } while (loop);
}
