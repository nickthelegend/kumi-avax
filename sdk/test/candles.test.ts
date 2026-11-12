// Candles from real sources only: Coinbase/Binance public candles, Chainlink rounds on Fuji, Kumi's own fills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS, DEPLOYMENT, perpsAbi, client, fetchCandles, buildCandles, markersFor, rangeOf, priceTicks, parseCoinbase, parseBinance, chainlinkRounds, bucketOf } from '../src/index.ts';

test('buildCandles: OHLC per bucket, gaps stay gaps', () => {
  const c = buildCandles([{ ts: 120, price: 10 }, { ts: 130, price: 12, size: 2 }, { ts: 150, price: 9 }, { ts: 179, price: 11 }, { ts: 300, price: 20 }], 60);
  assert.deepEqual(c, [{ t: 120, o: 10, h: 12, l: 9, c: 11, v: 2 }, { t: 300, o: 20, h: 20, l: 20, c: 20, v: 0 }]);
});
test('markers only land on candles that exist', () => {
  const candles = [{ t: 600, o: 1, h: 1, l: 1, c: 1, v: 0 }, { t: 660, o: 1, h: 1, l: 1, c: 1, v: 0 }];
  const m = markersFor(candles, [{ ts: 610, price: 1, size: 1, takerBuy: true }, { ts: 719, price: 1, size: 1, takerBuy: false }, { ts: 720, price: 1, size: 1, takerBuy: true }, { ts: 10, price: 1, size: 1, takerBuy: true }], 60);
  assert.deepEqual(m.map(x => x.t), [600, 660]);
});
test('range and ticks', () => {
  const r = rangeOf([{ t: 0, o: 8.5, h: 8.6, l: 8.4, c: 8.55, v: 0 }], [8.7]);
  assert.ok(r.min < 8.4 && r.max > 8.7);
  const t = priceTicks(8.4, 8.7, 4);
  assert.ok(t.length >= 3 && t.every(v => v >= 8.4 && v <= 8.7));
  assert.equal(bucketOf(1799, 900), 900);
});
test('parsers reject non-arrays (an exchange error body)', () => {
  assert.throws(() => parseCoinbase({ message: 'NotFound' }), /Coinbase/);
  assert.throws(() => parseBinance({ code: 0, msg: 'restricted location' }), /Binance/);
});

test('live: AVAX 1m and BTC 1h candles from a public exchange, labelled with their source', { timeout: 30_000 }, async () => {
  const a = await fetchCandles('AVAX', '1m', 60);
  assert.ok(a.candles.length >= 30, `got ${a.candles.length}`);
  assert.ok(['Coinbase', 'Binance'].includes(a.source.name));
  for (let i = 1; i < a.candles.length; i++) assert.ok(a.candles[i]!.t > a.candles[i - 1]!.t, 'ascending');
  assert.ok(a.candles.every(c => c.t % 60 === 0 && c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c)));
  const b = await fetchCandles('BTC', '1h', 24);
  assert.ok(b.candles.every(c => c.t % 3600 === 0));
  assert.ok(b.candles.at(-1)!.c > 1000, 'BTC trades in the thousands');
  await assert.rejects(fetchCandles('NOPE', '1m'), /No candle source/);
});

const pub = client();
test('live Fuji: Chainlink AVAX/USD rounds walk back in time and agree with the exchange within 3%', { timeout: 60_000 }, async () => {
  const rounds = await chainlinkRounds(pub as any, MARKETS[0].feed as `0x${string}`, 8);
  assert.ok(rounds.length >= 4, `got ${rounds.length} rounds`);
  for (let i = 1; i < rounds.length; i++) assert.ok(rounds[i]!.ts >= rounds[i - 1]!.ts);
  const { candles } = await fetchCandles('AVAX', '1h', 48);
  const last = rounds.at(-1)!.price;
  const near = candles.at(-1)!.c;
  assert.ok(Math.abs(last - near) / near < 0.03, `Chainlink ${last} vs exchange ${near}`);
});

test('live Fuji: Kumi fills from the on-chain trade ring become candles and markers', { timeout: 60_000 }, async () => {
  const trades = await pub.readContract({ address: DEPLOYMENT.perps as `0x${string}`, abi: perpsAbi, functionName: 'recentTrades', args: [0, 64n] });
  assert.ok(trades.length > 0, 'AVAX has fills on Fuji');
  const fills = trades.map(t => ({ ts: Number(t.ts), price: Number(t.price) / 1e8, size: Number(t.size) / 1e18, takerBuy: t.takerBuy }));
  const own = buildCandles(fills, 3600);
  assert.ok(own.length >= 1);
  const marks = markersFor(own, fills, 3600);
  assert.equal(marks.length, fills.length, 'every fill lands on its own candle');
});
