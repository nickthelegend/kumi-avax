// Order encoding. The pure cases check tick/lot/flag maths; the Fuji cases encode against the live book and have
// KumiPerps itself accept the order in an eth_call simulation (no tx is sent, nothing is mocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS, PX_SIZE, perpsAbi, DEPLOYMENT, client, toTick, toLot, sizeFor, initialMargin, marketLimit, encodeOrder, parseDecimal, notionalOf, FLAG } from '../src/index.ts';

const AVAX = MARKETS[0];
const BTC = MARKETS[1];

test('ticks round buys up and sells down', () => {
  assert.equal(toTick(AVAX, 873_412_345n, true), 873_500_000n);
  assert.equal(toTick(AVAX, 873_412_345n, false), 873_400_000n);
  assert.equal(toTick(AVAX, 873_400_000n, true), 873_400_000n);
});
test('size from margin x leverage, on the lot', () => {
  // 50 tUSDC x 3 at $8.50 = 17.647... AVAX -> 17.64 on a 0.01 lot
  const s = sizeFor(AVAX, 50_000_000n, 3, 850_000_000n);
  assert.equal(s, 17_640_000_000_000_000_000n);
  assert.equal(s % AVAX.lot, 0n);
  assert.ok(notionalOf(s, 850_000_000n) <= 150_000_000n);
  assert.equal(toLot(BTC, 123_456_789_012_345n), 120_000_000_000_000n);
});
test('initial margin is 10% of notional, rounded up', () => {
  assert.equal(initialMargin(10n * 10n ** 18n, 850_000_000n), 8_500_000n);
  assert.equal(initialMargin(1n, 1n), 1n);
});
test('market limit: touch plus slippage, clamped into the oracle band', () => {
  assert.equal(marketLimit(AVAX, true, 850_400_000n, 850_000_000n, 50), 854_700_000n);
  assert.equal(marketLimit(AVAX, false, 849_600_000n, 850_000_000n, 50), 845_300_000n);
  // a touch far above the oracle is clamped to +5%
  const hi = marketLimit(AVAX, true, 990_000_000n, 850_000_000n, 50);
  assert.ok(hi <= 850_000_000n * 10_500n / 10_000n && hi % AVAX.tick === 0n);
  // empty book: falls back to the oracle
  assert.equal(marketLimit(AVAX, true, 0n, 850_000_000n, 50), 854_300_000n);
});
test('encodeOrder: flags and validation', () => {
  const ctx = { touch: 850_400_000n, oracle: 850_000_000n };
  const mkt = encodeOrder({ market: 0, isBuy: true, kind: 'market', size: 10n ** 18n }, ctx);
  assert.equal(mkt[4], FLAG.IOC);
  const lim = encodeOrder({ market: 0, isBuy: false, kind: 'limit', price: 860_000_000n, size: 10n ** 18n, postOnly: true, reduceOnly: true }, ctx);
  assert.deepEqual(lim, [0, false, 860_000_000n, 10n ** 18n, FLAG.POST_ONLY | FLAG.REDUCE_ONLY]);
  assert.throws(() => encodeOrder({ market: 0, isBuy: true, kind: 'limit', price: 860_000_001n, size: 10n ** 18n }, ctx), /tick/);
  assert.throws(() => encodeOrder({ market: 0, isBuy: true, kind: 'limit', price: 860_000_000n, size: 10n ** 18n + 1n }, ctx), /lot/);
  assert.throws(() => encodeOrder({ market: 0, isBuy: true, kind: 'market', size: 0n }, ctx), /above zero/);
  assert.throws(() => encodeOrder({ market: 0, isBuy: true, kind: 'market', size: 10n ** 18n, postOnly: true }, ctx), /post-only/);
});
test('parseDecimal never uses floats', () => {
  assert.equal(parseDecimal('8.734', 8), 873_400_000n);
  assert.equal(parseDecimal('1,250.5', 6), 1_250_500_000n);
  assert.equal(parseDecimal('.5', 6), 500_000n);
  assert.throws(() => parseDecimal('1e3', 6));
  assert.throws(() => parseDecimal('0.1234567', 6), /decimals/);
});

// ---------------------------------------------------------------- against Fuji
const pub = client();
const PERPS = DEPLOYMENT.perps as `0x${string}`;
// sora, a Kumi test account with margin on the venue from the v2 seed (address only; no key here)
const SORA = '0xcb1268aa3fe4fe543e234e53daa2c3e17de23c5d' as const;

test('Fuji: a market buy encoded from the live book is accepted by KumiPerps (eth_call)', { timeout: 60_000 }, async () => {
  const [info, [oracle]] = await Promise.all([
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [0] }),
    pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'oraclePrice', args: [0] }),
  ]);
  assert.ok(info.bestAsk > 0n, 'the AVAX book has asks');
  const size = sizeFor(AVAX, 5_000_000n, 2, info.bestAsk); // 5 tUSDC at 2x
  const args = encodeOrder({ market: 0, isBuy: true, kind: 'market', size }, { touch: info.bestAsk, oracle });
  const { result } = await pub.simulateContract({ account: SORA, address: PERPS, abi: perpsAbi, functionName: 'placeOrder', args: args as any });
  assert.equal(result[1].filled, size, 'fully filled against the resting asks');
  assert.ok(result[1].notional > 0n);
});

test('Fuji: a limit outside the oracle band is refused by the venue', { timeout: 60_000 }, async () => {
  const [oracle] = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'oraclePrice', args: [0] });
  const far = toTick(AVAX, oracle * 12n / 10n, true);
  const args = encodeOrder({ market: 0, isBuy: false, kind: 'limit', price: far, size: AVAX.lot * 100n }, { touch: 0n, oracle });
  await assert.rejects(pub.simulateContract({ account: SORA, address: PERPS, abi: perpsAbi, functionName: 'placeOrder', args: args as any }), /OutsideBand/);
});
