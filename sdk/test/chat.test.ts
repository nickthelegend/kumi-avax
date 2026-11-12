// The chat client against the live Fuji lobby and crews. Copies are checked against KumiPerps positions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOYMENT, perpsAbi, client, readChannels, readChannelMessages, readCrewMessages, readCrewList, preview, unreadCount, type ChatItem } from '../src/index.ts';

const pub = client() as any;
const LOBBY = DEPLOYMENT.lobby as `0x${string}`;
const name = (a: string) => (DEPLOYMENT.names as Record<string, string>)[a.toLowerCase()] ?? a.slice(0, 6);

test('lobby: the three public channels, with membership for a test account', { timeout: 60_000 }, async () => {
  const sora = '0xcb1268aa3fe4fe543e234e53daa2c3e17de23c5d';
  const chans = await readChannels(pub, LOBBY, sora);
  assert.ok(chans.length >= 3);
  const pit = chans.find(c => c.name === 'AVAX pit')!;
  assert.ok(pit && pit.joined && pit.memberCount >= 5 && pit.messageCount >= 10);
  assert.equal(chans.find(c => c.name === 'BTC desk')!.joined, false);
});

test('lobby: a call and its copies; each copy matches a real long on KumiPerps', { timeout: 60_000 }, async () => {
  const msgs = await readChannelMessages(pub, LOBBY, DEPLOYMENT.lobbyChannels.avaxpit);
  const call = msgs.find(m => m.kind === 'call')!;
  assert.ok(call && call.isLong && call.leverage === 3 && call.amount === 50_000_000n);
  assert.ok(call.price! > 0n, 'Chainlink price recorded at call time');
  const copies = msgs.filter(m => m.kind === 'copy' && m.ref === call.index);
  assert.ok(copies.length >= 2);
  for (const c of copies) {
    assert.ok(c.orderTx, 'copy links its order tx');
    const receipt = await pub.getTransactionReceipt({ hash: c.orderTx });
    assert.equal(receipt.status, 'success');
    assert.equal(receipt.from.toLowerCase(), c.who.toLowerCase(), 'the order came from the copier');
    assert.equal(receipt.to.toLowerCase(), DEPLOYMENT.perps.toLowerCase());
  }
  assert.match(preview(call, name), /called Long AVAX 3x, 50 tUSDC/);
  assert.match(preview(copies[0]!, name), /copied: long [\d.]+ AVAX at \$/);
});

test('crews: list, membership and the on-chain feed', { timeout: 90_000 }, async () => {
  const jun = '0x232a67f57752b06e1d847aa37d8abf10de3d70d8';
  const crews = await readCrewList(pub, DEPLOYMENT.factory as `0x${string}`, jun);
  assert.ok(crews.length >= 4);
  const sunrise = crews.find(c => c.name === 'Sunrise Scalpers')!;
  assert.ok(sunrise.isMember && sunrise.nav > 0n);
  const feed = await readCrewMessages(pub, sunrise.address);
  assert.ok(feed.some(m => m.kind === 'chat') && feed.some(m => m.kind === 'pitch') && feed.some(m => m.kind === 'executed') && feed.some(m => m.kind === 'deposit'));
  const positions = await pub.readContract({ address: DEPLOYMENT.perps, abi: perpsAbi, functionName: 'positionsOf', args: [sunrise.address] });
  assert.ok(positions.length >= 1, 'the voted long is open on the venue');
});

test('unread skips my own messages and joins', () => {
  const m = (index: number, who: string, kind: ChatItem['kind'] = 'chat') => ({ key: String(index), source: 'lobby', index, kind, who, ts: 0, block: 0n, text: '', ref: 0, amount: 0n }) as ChatItem;
  const items = [m(0, '0xa', 'join'), m(1, '0xa'), m(2, '0xB'), m(3, '0xb'), m(4, '0xc', 'join')];
  assert.equal(unreadCount(items, 0, '0xb'), 1);
  assert.equal(unreadCount(items, -1), 3);
});
