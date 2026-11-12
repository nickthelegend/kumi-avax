// Kumi AI against live Fuji: each read-only tool agrees with a direct chain read, the draft tool validates, the
// endpoint refuses bad passes and non-members, and one real claude-haiku-5-5 run answers with visible tool calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { DEPLOYMENT, MARKETS, askMessage, perpsAbi, price as fmtPrice, readLeaderboard, usd as fmtUsd } from '@kumi-avax/sdk';
import { handleAsk } from '../src/ask.ts';
import { cachedBoard, chatOf, isMemberOf, runTool, type Ctx } from '../src/tools.ts';
import { fujiClient } from '../src/pub.ts';
import { ANTHROPIC_ENV, REPO_ENV } from './env.ts';

const pub = fujiClient();
const PERPS = DEPLOYMENT.perps as Address;
const sora = privateKeyToAccount(REPO_ENV.KUMI_SORA_KEY as Hex);
const pit = `l-${DEPLOYMENT.lobbyChannels.avaxpit}`;
const nightOwls = `c-${DEPLOYMENT.crews[0]!.address}`;
const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;
const ctxFor = async (chat: string, me: Address): Promise<Ctx> => ({ pub, chat: await chatOf(pub, chat), me, board: cachedBoard(pub) });
async function pass(key: Hex, expires = Math.floor(Date.now() / 1000) + 3000) {
  const a = privateKeyToAccount(key);
  return { address: a.address, expires, signature: await a.signMessage({ message: askMessage(a.address, expires) }) };
}

test('order_book matches KumiPerps getMarket and depth on Fuji', { timeout: 60_000 }, async () => {
  const ctx = await ctxFor(pit, sora.address);
  const out: any = await runTool('order_book', { market: 'AVAX' }, ctx);
  const info = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [0] });
  assert.equal(out.bestBid, fmtPrice(info.bestBid, 3));
  assert.equal(out.bestAsk, fmtPrice(info.bestAsk, 3));
  assert.ok(out.bids.length > 0 && out.asks.length > 0 && out.fills === Number(info.tradeCount));
});

test('chainlink_price matches the Fuji feed', { timeout: 60_000 }, async () => {
  const out: any = await runTool('chainlink_price', { market: 'BTC' }, await ctxFor(pit, sora.address));
  const r = await pub.readContract({ address: MARKETS[1].feed as Address, abi: feedAbi, functionName: 'latestRoundData' });
  assert.equal(out.price, fmtPrice(r[1], 0));
  assert.equal(out.address, MARKETS[1].feed);
});

test('chat_activity lists the AVAX pit calls with their copies; a crew room lists its pitches', { timeout: 120_000 }, async () => {
  const out: any = await runTool('chat_activity', {}, await ctxFor(pit, sora.address));
  assert.ok(out.calls.length >= 3);
  const mika = out.calls.find((c: any) => c.by === 'mika');
  assert.ok(mika && mika.copies.length >= 6 && mika.chainlinkAtCall === '8.504');
  const crew: any = await runTool('chat_activity', {}, await ctxFor(nightOwls, sora.address));
  assert.equal(crew.chat, 'Night Owls');
  assert.ok(crew.pitchesAndFills.some((p: any) => p.kind === 'executed' || p.kind === 'pitch'));
});

test('top_callers and caller_record agree with readLeaderboard', { timeout: 120_000 }, async () => {
  const ctx = await ctxFor(pit, sora.address);
  const b = await readLeaderboard(pub, { lobby: DEPLOYMENT.lobby as Address, perps: PERPS, fromBlock: BigInt(DEPLOYMENT.perpsDeployBlock) });
  const all: any = await runTool('top_callers', { scope: 'all' }, ctx);
  assert.equal(all.totalCallers, b.global.length);
  assert.equal(all.top[0].calls, b.global[0]!.calls);
  const rec: any = await runTool('caller_record', { caller: 'mika' }, ctx);
  const m = b.global.find(s => s.who.toLowerCase() === '0x857429f6d1304b8ef42de42a0696f52a5fbe3acf')!;
  assert.equal(rec.global.calls, m.calls);
  assert.equal(rec.global.copies, m.copies);
  assert.equal((await runTool('caller_record', { caller: 'nobody-here' }, ctx) as any).error.includes('No Kumi caller'), true);
});

test("my_positions matches the asker's KumiPerps positions", { timeout: 60_000 }, async () => {
  const out: any = await runTool('my_positions', {}, await ctxFor(pit, sora.address));
  const pos = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'positionsOf', args: [sora.address] });
  assert.equal(out.positions.length, pos.length);
  const col = await pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'collateral', args: [sora.address] });
  assert.equal(out.marginUsdc, fmtUsd(col));
});

test('draft_call: a lobby draft with margin, a crew draft as a pitch command within the crew leverage cap', { timeout: 60_000 }, async () => {
  const lobby = await ctxFor(pit, sora.address);
  await runTool('draft_call', { market: 'AVAX', side: 'short', leverage: 2, marginUsdc: 30, note: 'retest' }, lobby);
  assert.deepEqual(lobby.draft, { market: 'AVAX', side: 'short', leverage: 2, marginUsdc: 30, note: 'retest' });
  const crew = await ctxFor(nightOwls, sora.address);
  const tooHigh: any = await runTool('draft_call', { market: 'BTC', side: 'long', leverage: 9 }, crew);
  assert.match(tooHigh.error, /at most 5x/);
  await runTool('draft_call', { market: 'BTC', side: 'long', leverage: 2, sizePct: 10 }, crew);
  assert.equal(crew.draft!.command, '/long BTC 2x 10%');
});

test('the endpoint: setup required without a key; bad or expired pass; non-members refused', { timeout: 60_000 }, async () => {
  const body = { chat: pit, question: 'spread?', ...(await pass(REPO_ENV.KUMI_SORA_KEY as Hex)) };
  const noKey = await handleAsk(body, '198.51.100.20', {}, pub);
  assert.equal(noKey.status, 503);
  assert.match(String(noKey.body.error), /^Setup required/);
  const env = { ANTHROPIC_API_KEY: 'unused-before-auth' };
  assert.equal((await handleAsk({ ...body, signature: (await pass(generatePrivateKey())).signature }, '198.51.100.20', env, pub)).status, 401);
  assert.equal((await handleAsk({ ...body, expires: Math.floor(Date.now() / 1000) - 10 }, '198.51.100.20', env, pub)).status, 401);
  const stranger = generatePrivateKey();
  assert.equal(await isMemberOf(pub, await chatOf(pub, pit), privateKeyToAccount(stranger).address), false);
  const r = await handleAsk({ chat: pit, question: 'hi', ...(await pass(stranger)) }, '198.51.100.20', env, pub);
  assert.equal(r.status, 403);
  assert.equal((await handleAsk({ ...body, chat: 'c-0x0000000000000000000000000000000000000001' }, '198.51.100.20', env, pub)).status, 400);
});

test('a real Kumi AI answer (claude-haiku-5-5) with visible tool calls', { timeout: 120_000, skip: !ANTHROPIC_ENV.ANTHROPIC_API_KEY && 'no ANTHROPIC_API_KEY in ~/.config/grokbot/anthropic.env' }, async () => {
  const body = { chat: pit, question: 'What is the AVAX spread on the book right now, and who is the top caller in this chat?', ...(await pass(REPO_ENV.KUMI_SORA_KEY as Hex)) };
  const r = await handleAsk(body, '198.51.100.21', { ANTHROPIC_API_KEY: ANTHROPIC_ENV.ANTHROPIC_API_KEY }, pub);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const tools = (r.body.tools as { name: string }[]).map(t => t.name);
  assert.ok(tools.includes('order_book'), `tools: ${tools}`);
  assert.ok(tools.includes('top_callers') || tools.includes('chat_activity'), `tools: ${tools}`);
  assert.ok(String(r.body.answer).length > 20);
  console.log(`Kumi AI (${r.body.ms} ms, ${tools.join(', ')}): ${r.body.answer}`);
});
