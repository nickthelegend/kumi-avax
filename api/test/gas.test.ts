// Kumi's gas sponsor against live Fuji: abuse cases first (no AVAX moves), then one real drip to a brand-new wallet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodeEventLog, type Hex } from 'viem';
import { gasDigest, gasStationAbi } from '@kumi-avax/sdk';
import { handleGas, STATION } from '../src/gas.ts';
import { fujiClient } from '../src/pub.ts';
import { REPO_ENV } from './env.ts';

const pub = fujiClient();
const env = { KUMI_SPONSOR_KEY: REPO_ENV.KUMI_SPONSOR_KEY, KUMI_TAG_SECRET: 'kumi-test-tag-secret' };
const now = () => BigInt(Math.floor(Date.now() / 1000));
async function req(key: Hex, opts: { deadline?: bigint; to?: `0x${string}` } = {}) {
  const a = privateKeyToAccount(key);
  const deadline = opts.deadline ?? now() + 600n;
  const to = opts.to ?? a.address;
  const signature = await a.signMessage({ message: { raw: gasDigest(STATION, to, deadline) } });
  return { address: to, deadline: deadline.toString(), signature };
}
const fresh = generatePrivateKey();

test('setup required when the sponsor key or tag secret is missing', async () => {
  const r = await handleGas(await req(fresh), '198.51.100.1', {}, pub);
  assert.equal(r.status, 503);
  assert.equal(r.body.setup, true);
  assert.match(String(r.body.error), /^Setup required/);
});

test('malformed requests are refused before any chain read', async () => {
  assert.equal((await handleGas({ address: '0x12', deadline: '1', signature: '0x' }, '198.51.100.2', env, pub)).status, 400);
  assert.equal((await handleGas({ ...(await req(fresh)), signature: '0x1234' }, '198.51.100.2', env, pub)).status, 400);
  assert.equal((await handleGas({ ...(await req(fresh)), deadline: 'soon' }, '198.51.100.2', env, pub)).status, 400);
});

test('a signature from another key, or moved to another wallet, is refused (401)', async () => {
  const victim = privateKeyToAccount(fresh).address;
  const forged = await req(generatePrivateKey(), { to: victim });
  const r = await handleGas(forged, '198.51.100.3', env, pub);
  assert.equal(r.status, 401);
  assert.match(String(r.body.error), /not from this wallet/);
});

test('expired and far-future deadlines are refused', async () => {
  assert.equal((await handleGas(await req(fresh, { deadline: now() - 5n }), '198.51.100.4', env, pub)).status, 400);
  assert.equal((await handleGas(await req(fresh, { deadline: now() + 7200n }), '198.51.100.4', env, pub)).status, 400);
});

test('a wallet that already holds AVAX is not new (409), checked on Fuji', { timeout: 60_000 }, async () => {
  const r = await handleGas(await req(REPO_ENV.KUMI_MIKA_KEY as Hex), '198.51.100.5', env, pub);
  assert.equal(r.status, 409);
  assert.match(String(r.body.error), /already has Fuji AVAX/);
});

test('a brand-new wallet gets 0.0002 AVAX from KumiGasStation on Fuji, once', { timeout: 120_000 }, async () => {
  const a = privateKeyToAccount(fresh).address;
  const r = await handleGas(await req(fresh), '198.51.100.6', env, pub);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rc = await pub.getTransactionReceipt({ hash: r.body.hash as Hex });
  assert.equal(rc.status, 'success');
  const ev = rc.logs.map(l => { try { return decodeEventLog({ abi: gasStationAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find(e => e?.eventName === 'Dripped') as any;
  assert.equal(ev.args.to.toLowerCase(), a.toLowerCase());
  assert.equal(ev.args.amount, 2n * 10n ** 14n);
  assert.equal(await pub.getBalance({ address: a, blockNumber: rc.blockNumber }), 2n * 10n ** 14n);
  console.log(`drip ${r.body.hash} to ${a}`);
  // the same wallet again: already dripped (on-chain flag), even from another network
  const again = await handleGas(await req(fresh), '198.51.100.7', env, pub);
  assert.equal(again.status, 409);
  assert.match(String(again.body.error), /already got its first sip/);
});

test('per-IP limiter: the 7th request in an hour from one network is refused (429)', { timeout: 120_000 }, async () => {
  const ip = '203.0.113.77';
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await handleGas(await req(fresh), ip, env, pub)).status);
  assert.deepEqual(statuses, [409, 409, 409, 409, 409, 409, 429]);
});

test('the station reports its caps and funding on-chain for a requester tag', { timeout: 60_000 }, async () => {
  const room = await pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'room', args: ['0x' + 'ab'.repeat(32) as Hex] });
  assert.ok(room[0] <= 20n && room[1] === 3n && room[2] > 0n);
});
