// Caller leaderboard against live Fuji: the fill replay must agree with KumiPerps positions, each copy's lot with the
// fills in its own order tx, and each call's entry with the price KumiLobby stored. Plus the FIFO math on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEventLog, type Address } from 'viem';
import { DEPLOYMENT, MARKETS, PX_SIZE, client, lobbyAbi, perpsAbi, readFills, readLeaderboard, lotsFor, callReturnBps, callerOf, type VenueFill } from '../src/index.ts';

const pub = client() as any;
const LOBBY = DEPLOYMENT.lobby as Address;
const PERPS = DEPLOYMENT.perps as Address;
const FROM = BigInt(DEPLOYMENT.perpsDeployBlock);
const board = readLeaderboard(pub, { lobby: LOBBY, perps: PERPS, fromBlock: FROM });

test('FIFO: a long opened in two lots, partly closed, then flipped short', () => {
  const me = '0x00000000000000000000000000000000000000aa' as Address;
  const other = '0x00000000000000000000000000000000000000bb' as Address;
  const f = (i: number, takerBuy: boolean, price: bigint, size: bigint, tx: string): VenueFill => ({ market: 0, maker: other, taker: me, takerBuy, price, size, block: BigInt(i), logIndex: 0, tx: tx as any });
  const E = 10n ** 18n;
  const lots = lotsFor([
    f(1, true, 10_00000000n, 2n * E, '0x01'), // buy 2 @ 10
    f(2, true, 12_00000000n, 1n * E, '0x02'), // buy 1 @ 12
    f(3, false, 13_00000000n, 2n * E + E / 2n, '0x03'), // sell 2.5 @ 13: closes 2 @10 (+6) and 0.5 @12 (+0.5)
    f(4, false, 11_00000000n, 1n * E, '0x04'), // sell 1 @ 11: closes 0.5 @12 (-0.5), opens 0.5 short @ 11
  ], me, 0);
  assert.equal(lots.length, 3);
  assert.deepEqual(lots.map(l => [l.tx, l.size, l.realized]), [['0x01', 0n, 6_000000n], ['0x02', 0n, 0n], ['0x04', -E / 2n, 0n]]);
  assert.equal(lots[1]!.realized === 0n, true); // +0.5 then -0.5 on the 12 lot
  // a maker fill counts from the maker's side: taker sells into my bid = I bought
  const asMaker = lotsFor([{ ...f(5, false, 10_00000000n, E, '0x05'), maker: me, taker: other }], me, 0);
  assert.equal(asMaker[0]!.size, E);
});

test('call return: leveraged, signed by side', () => {
  assert.equal(callReturnBps(10_00000000n, 10_10000000n, true, 3), 300);
  assert.equal(callReturnBps(10_00000000n, 10_10000000n, false, 2), -200);
  assert.equal(callReturnBps(10_00000000n, 10_00000000n, true, 5), 0);
});

test('fill replay matches every KumiPerps position on Fuji', { timeout: 180_000 }, async () => {
  const b = await board;
  const fills = await readFills(pub, PERPS, FROM, b.head);
  assert.ok(fills.length > 10, `expected the venue's history, got ${fills.length} fills`);
  const accounts = new Set<string>();
  for (const c of b.calls) for (const x of c.copies) accounts.add(x.who.toLowerCase());
  assert.ok(accounts.size >= 6);
  for (const a of accounts) for (const m of MARKETS) {
    const [size] = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'positions', args: [a, m.id], blockNumber: b.head });
    const open = lotsFor(fills, a as Address, m.id).reduce((s, l) => s + l.size, 0n);
    assert.equal(open, size, `${a} ${m.symbol}: replay ${open} vs venue ${size}`);
  }
});

test('each exact copy is the fills of its own order tx; its entry is the lobby price at call time', { timeout: 180_000 }, async () => {
  const b = await board;
  let checked = 0;
  for (const c of b.calls) {
    const m = await pub.readContract({ address: LOBBY, abi: lobbyAbi, functionName: 'getMessage', args: [BigInt(c.channel), BigInt(c.index)] });
    assert.equal(m.price, c.entry);
    assert.equal(m.who.toLowerCase(), c.who.toLowerCase());
    for (const x of c.copies.filter(x => x.exact)) {
      const msgs = await pub.readContract({ address: LOBBY, abi: lobbyAbi, functionName: 'messageSlice', args: [BigInt(c.channel), 0n, 500n] });
      const copy = msgs.find((y: any) => y.kind === 2 && Number(y.ref) === c.index && y.who.toLowerCase() === x.who.toLowerCase());
      const rc = await pub.getTransactionReceipt({ hash: copy.orderTx });
      let filled = 0n;
      for (const log of rc.logs) {
        if (log.address.toLowerCase() !== PERPS.toLowerCase()) continue;
        try { const e = decodeEventLog({ abi: perpsAbi, data: log.data, topics: log.topics }) as any; if (e.eventName === 'Filled' && e.args.taker.toLowerCase() === x.who.toLowerCase()) filled += e.args.size; } catch { /* other events */ }
      }
      // what the order filled = what is still open plus what was closed since
      const lots = lotsFor(await readFills(pub, PERPS, FROM, b.head), x.who, c.market).filter(l => l.tx.toLowerCase() === copy.orderTx.toLowerCase());
      assert.ok(filled > 0n && lots.length > 0);
      assert.ok(x.open <= filled, `${x.who}: open ${x.open} > filled ${filled}`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `checked ${checked} copies`);
});

test("ren's closed copy: realised PnL equals the close fill against the copy's entry", { timeout: 120_000 }, async () => {
  const b = await board;
  const ren = '0x9b1d8f9cb095a9dcb80adc394561609a819b4363';
  const call = b.calls.find(c => c.channel === DEPLOYMENT.lobbyChannels.avaxpit && c.copies.some(x => x.who.toLowerCase() === ren && x.open === 0n))!;
  assert.ok(call, 'ren closed his copy in seedV22');
  const x = call.copies.find(x => x.who.toLowerCase() === ren)!;
  assert.equal(x.unrealized, 0n);
  const fills = (await readFills(pub, PERPS, FROM, b.head)).filter(f => f.market === 0 && (f.taker.toLowerCase() === ren || f.maker.toLowerCase() === ren));
  const lots = lotsFor(fills, ren as Address, 0);
  const lot = lots.filter(l => l.size === 0n && l.realized === x.realized);
  assert.ok(lot.length >= 1);
  // independent: closes sold the whole lot; realised = sum(close size x (close price - lot price))
  const sells = fills.filter(f => f.taker.toLowerCase() === ren && !f.takerBuy);
  const opened = fills.filter(f => f.taker.toLowerCase() === ren && f.takerBuy);
  const qty = opened.reduce((s, f) => s + f.size, 0n);
  const cost = opened.reduce((s, f) => s + f.size * f.price, 0n);
  const proceeds = sells.reduce((s, f) => s + f.size * f.price, 0n);
  assert.equal(sells.reduce((s, f) => s + f.size, 0n), qty);
  const expected = (proceeds - cost) / PX_SIZE;
  assert.ok(x.realized - expected <= 1n && expected - x.realized <= 1n, `realised ${x.realized} vs ${expected}`);
});

test('callers: counts, wins and copy PnL add up from the calls; ranks are 1..n', { timeout: 120_000 }, async () => {
  const b = await board;
  assert.ok(b.global.length >= 6);
  b.global.forEach((s, i) => assert.equal(s.rank, i + 1));
  const firstUnscored = b.global.findIndex(s => s.scored === 0);
  if (firstUnscored >= 0) assert.ok(b.global.slice(firstUnscored).every(s => s.scored === 0), 'unscored callers rank last');
  for (const s of b.global) {
    const mine = b.calls.filter(c => c.who.toLowerCase() === s.who.toLowerCase());
    assert.equal(s.calls, mine.length);
    assert.equal(s.wins, mine.filter(c => c.win === true).length);
    assert.equal(s.copies, mine.reduce((a, c) => a + c.copies.length, 0));
    assert.equal(s.copyPnl, mine.reduce((a, c) => a + c.copyPnl, 0n));
  }
  // marks are Chainlink now
  const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;
  const [, avax] = await pub.readContract({ address: MARKETS[0].feed, abi: feedAbi, functionName: 'latestRoundData' });
  assert.ok(avax === b.marks[0] || Math.abs(Number(avax - b.marks[0]!)) / Number(avax) < 0.02);
  const per = b.byChannel[DEPLOYMENT.lobbyChannels.btcdesk]!;
  assert.ok(per.length >= 3 && per.every(s => b.calls.some(c => c.channel === DEPLOYMENT.lobbyChannels.btcdesk && c.who.toLowerCase() === s.who.toLowerCase())));
  assert.equal(callerOf(b, per[0]!.who, DEPLOYMENT.lobbyChannels.btcdesk)!.rank, 1);
});
