import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, describe } from '../src/parse.ts';

test('long with leverage and size', () => {
  const r = parseCommand('/long AVAX 3x 20%');
  assert.ok(r && r.ok);
  assert.deepEqual(r.cmd, { kind: 'open', market: 0, symbol: 'AVAX', isLong: true, leverage: 3, sizeBps: 2000, defaultedSize: false, captain: false });
  assert.equal(describe(r.cmd), '/long AVAX 3x 20%');
});
test('short BTC, case and spaces', () => {
  const r = parseCommand('  /SHORT  btc 2X 10% ');
  assert.ok(r && r.ok && r.cmd.kind === 'open');
  assert.equal(r.cmd.isLong, false);
  assert.equal(r.cmd.market, 1);
  assert.equal(r.cmd.sizeBps, 1000);
});
test('size defaults to 20% and says so', () => {
  const r = parseCommand('/long AVAX 3x');
  assert.ok(r && r.ok && r.cmd.kind === 'open');
  assert.equal(r.cmd.sizeBps, 2000);
  assert.equal(r.cmd.defaultedSize, true);
});
test('leverage above the crew policy is refused with the limit', () => {
  const r = parseCommand('/long AVAX 9x 10%', 5);
  assert.deepEqual(r, { ok: false, error: 'This crew allows 1x to 5x.' });
});
test('unknown market, missing leverage, bad size', () => {
  assert.equal(parseCommand('/long DOGE 2x')?.ok, false);
  assert.equal(parseCommand('/long AVAX 20%')?.ok, false);
  assert.equal(parseCommand('/long AVAX 2x 120%')?.ok, false);
});
test('close, partial close, captain lane, invite', () => {
  const c = parseCommand('/close AVAX 50%');
  assert.ok(c && c.ok && c.cmd.kind === 'close' && c.cmd.sizeBps === 5000);
  const cap = parseCommand('/captain long AVAX 2x 5%');
  assert.ok(cap && cap.ok && cap.cmd.kind === 'open' && cap.cmd.captain);
  const inv = parseCommand('/invite 0x0000000000000000000000000000000000000001');
  assert.ok(inv && inv.ok && inv.cmd.kind === 'invite');
  const setCap = parseCommand('/captain 0x0000000000000000000000000000000000000001');
  assert.ok(setCap && setCap.ok && setCap.cmd.kind === 'captain');
});
test('plain chat is not a command', () => {
  assert.equal(parseCommand('gm crew'), null);
});
