/**
 * Kumi v2 on Fuji: deploys KumiLobby, then brings Kumi's test accounts to life so the chats, the book and the candle
 * markers are real. Everything here is a real Fuji transaction from a Kumi test account (keys by name from the
 * gitignored .env, never printed), recorded with its hash under "seedV2" in deployments/fuji.json.
 *
 *   node fuji/seed-v2.ts          run every step not yet done (steps are idempotent by label)
 *
 * Test accounts: mika, bo, ren (v1) and jun, sora, tae, lia (v2). The app labels all of them as Kumi test accounts.
 */
import { decodeEventLog, parseEther, type Account, type Hex } from 'viem';
import { MARKETS, crewAbi, factoryAbi, lobbyAbi, perpsAbi, usdcAbi, sizeFor, marketLimit, FLAG, Kind } from '@kumi-avax/sdk';
import { account, ensureKeys } from './env.ts';
import { artifact, deploy, load, pub, save, send, transfer } from './tx.ts';

ensureKeys();
const SECTION = 'seedV2';
const d0 = load();
const c = d0.contracts;
const done = new Set<string>((d0[SECTION] ?? []).map((t: { label: string }) => t.label));
const deployer = account('KUMI_DEPLOYER_KEY');
const maker = account('KUMI_MAKER_KEY');
const who = {
  mika: account('KUMI_MIKA_KEY'), bo: account('KUMI_BO_KEY'), ren: account('KUMI_REN_KEY'),
  jun: account('KUMI_JUN_KEY'), sora: account('KUMI_SORA_KEY'), tae: account('KUMI_TAE_KEY'), lia: account('KUMI_LIA_KEY'),
};
type Name = keyof typeof who;
const USD = (n: number) => BigInt(Math.round(n * 1e6));

async function step(label: string, a: Account, to: `0x${string}`, abi: any, fn: string, args: unknown[] = []) {
  if (done.has(label)) return null;
  // Two public RPCs sit behind the fallback transport; right after a receipt, the other one can lag a block,
  // so a dependent simulation (allowance, nonce) may briefly see stale state. Retry a few times, then fail loudly.
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

// ---------------------------------------------------------------- 1. lobby
if (!c.lobby) {
  const a = artifact('KumiLobby.sol', 'KumiLobby');
  const addr = await deploy(deployer, 'deploy_KumiLobby', a.abi, a.bytecode, [c.perps]);
  const x = load(); x.contracts.lobby = addr; save(x); c.lobby = addr;
}
const lobby = c.lobby as `0x${string}`;
const perps = c.perps as `0x${string}`;
const usdc = c.usdc as `0x${string}`;

// ---------------------------------------------------------------- 2. gas and test dollars
for (const n of ['jun', 'sora', 'tae', 'lia'] as Name[]) {
  const bal = await pub.getBalance({ address: who[n].address });
  if (bal < parseEther('0.0004') && !done.has(`gas_${n}`)) {
    const r = await transfer(maker, `gas_${n}`, who[n].address, parseEther('0.0008'));
    const x = load(); (x[SECTION] ??= []).push({ label: `gas_${n}`, hash: r.transactionHash, block: Number(r.blockNumber) }); save(x); done.add(`gas_${n}`);
  }
}
for (const n of Object.keys(who) as Name[]) await step(`mint_${n}`, deployer, usdc, usdcAbi, 'mint', [who[n].address, USD(3000)]);
for (const n of Object.keys(who) as Name[]) await step(`approve_perps_${n}`, who[n], usdc, usdcAbi, 'approve', [perps, 2n ** 256n - 1n]);

const x1 = load();
x1.accounts = { ...x1.accounts, jun: who.jun.address, sora: who.sora.address, tae: who.tae.address, lia: who.lia.address };
save(x1);

// ---------------------------------------------------------------- 3. crews
const policy = { thresholdBps: 5001, votingPeriod: 86400, maxLeverage: 5, maxSlippageBps: 100, captainMaxLeverage: 2, captainMaxBps: 1000, captainTradesPerDay: 2 };
const CREWS: { slug: string; name: string; members: Name[]; captain: Name }[] = [
  { slug: 'sunrise', name: 'Sunrise Scalpers', members: ['jun', 'sora', 'mika'], captain: 'jun' },
  { slug: 'slowbtc', name: 'Slow BTC Club', members: ['tae', 'lia', 'bo'], captain: 'tae' },
  { slug: 'frogpond', name: 'Frog Pond', members: ['lia', 'ren', 'jun', 'sora'], captain: 'lia' },
];
const crewAddr: Record<string, `0x${string}`> = {};
for (const k of (load().contracts.crews ?? [])) if (k.slug) crewAddr[k.slug] = k.address;
for (const cr of CREWS) {
  if (crewAddr[cr.slug]) continue;
  const creator = who[cr.members[0]!];
  const r = await send(creator, `create_crew_${cr.slug}`, c.factory, factoryAbi as any, 'createCrew', [cr.name, cr.members.map(n => who[n].address), who[cr.captain].address, policy], SECTION);
  let addr: `0x${string}` | undefined;
  for (const log of r.logs) {
    try { const e = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics }) as any; if (e.eventName === 'CrewCreated') addr = e.args.crew; } catch { /* other events */ }
  }
  if (!addr) throw Error('CrewCreated event missing');
  crewAddr[cr.slug] = addr;
  const x = load();
  x.contracts.crews.push({ slug: cr.slug, name: cr.name, address: addr, policy, members: Object.fromEntries(cr.members.map(n => [n, who[n].address])), captain: cr.captain });
  save(x);
}

async function chipIn(slug: string, n: Name, amount: number) {
  const crew = crewAddr[slug]!;
  await step(`approve_${slug}_${n}`, who[n], usdc, usdcAbi, 'approve', [crew, 2n ** 256n - 1n]);
  await step(`deposit_${slug}_${n}`, who[n], crew, crewAbi, 'deposit', [USD(amount)]);
}
const say = (slug: string, n: Name, i: number, text: string) => step(`say_${slug}_${n}_${i}`, who[n], crewAddr[slug]!, crewAbi, 'say', [text]);
async function pitchAndPass(slug: string, label: string, by: Name, voters: Name[], kind: number, market: number, isLong: boolean, lev: number, bps: number, note: string) {
  const crew = crewAddr[slug]!;
  if (!done.has(`pitch_${slug}_${label}`)) {
    await step(`pitch_${slug}_${label}`, who[by], crew, crewAbi, 'pitch', [kind, market, isLong, lev, bps, '0x0000000000000000000000000000000000000000', note]);
  }
  const id = Number(await pub.readContract({ address: crew, abi: crewAbi, functionName: 'proposalCount' })) - 1;
  for (const v of voters) {
    const p = await pub.readContract({ address: crew, abi: crewAbi, functionName: 'getProposal', args: [BigInt(id)] });
    if (p.executed) break;
    await step(`vote_${slug}_${label}_${v}`, who[v], crew, crewAbi, 'vote', [BigInt(id), true]);
  }
}

// Sunrise Scalpers: an AVAX long that opens by vote, then chat about it.
await chipIn('sunrise', 'jun', 600); await chipIn('sunrise', 'sora', 450); await chipIn('sunrise', 'mika', 300);
await say('sunrise', 'jun', 1, 'gm scalpers. AVAX holding 8.5 on Coinbase, Chainlink agrees');
await say('sunrise', 'sora', 1, 'book is tight on Kumi too, 1 bp spread. im in for a small long');
await pitchAndPass('sunrise', 'long_avax', 'jun', ['sora'], Kind.Open, 0, true, 2, 1500, 'AVAX bounce off 8.5');
await say('sunrise', 'mika', 1, 'filled on the book, nice. stop if it loses 8.40');

// Slow BTC Club: a small BTC long, decided slowly.
await chipIn('slowbtc', 'tae', 800); await chipIn('slowbtc', 'lia', 500); await chipIn('slowbtc', 'bo', 200);
await say('slowbtc', 'tae', 1, 'weekly plan: one BTC position, 2x max, no scalping');
await say('slowbtc', 'lia', 1, 'agreed. 10% of the jar, we hold through the weekend');
await pitchAndPass('slowbtc', 'long_btc', 'tae', ['lia'], Kind.Open, 1, true, 2, 1000, 'weekly BTC long');
await say('slowbtc', 'bo', 1, 'voted late but im happy with it');

// Frog Pond: a short that the crew votes down (a pitch with a no vote stays open, nothing trades).
await chipIn('frogpond', 'lia', 250); await chipIn('frogpond', 'ren', 250); await chipIn('frogpond', 'jun', 150); await chipIn('frogpond', 'sora', 100);
await say('frogpond', 'ren', 1, 'ribbit. who wants to fade this AVAX pump');
await step('pitch_frogpond_short_avax', who.ren, crewAddr.frogpond!, crewAbi, 'pitch', [Kind.Open, 0, false, 3, 1000, '0x0000000000000000000000000000000000000000', 'fade the pump']);
{
  const id = Number(await pub.readContract({ address: crewAddr.frogpond!, abi: crewAbi, functionName: 'proposalCount' })) - 1;
  await step('vote_frogpond_short_avax_lia_no', who.lia, crewAddr.frogpond!, crewAbi, 'vote', [BigInt(id), false]);
}
await say('frogpond', 'lia', 1, 'no from me, funding is paying longs right now');
await say('frogpond', 'jun', 1, 'same, lets wait for 9');

// Night Owls (v1 crew): the members still in it keep talking.
crewAddr.nightowls = c.crews[0].address;
await say('nightowls', 'mika', 1, 'back from the demo. BTC short still open, marked at Chainlink');
await say('nightowls', 'bo', 1, 'i kept 150 shares in. lets close it on the next dip');

// ---------------------------------------------------------------- 4. lobby channels, calls and verified copies
const CH: { slug: string; name: string; topic: string; market: number; by: Name }[] = [
  { slug: 'avaxpit', name: 'AVAX pit', topic: 'Calls and chat on AVAX-USD perps', market: 0, by: 'jun' },
  { slug: 'btcdesk', name: 'BTC desk', topic: 'Slow BTC ideas, 2x and under', market: 1, by: 'tae' },
  { slug: 'newbies', name: 'New to Kumi', topic: 'Ask anything. Get test USDC, then copy a call', market: 0, by: 'lia' },
];
const chId: Record<string, number> = { ...(load().lobbyChannels ?? {}) };
for (const ch of CH) {
  if (chId[ch.slug] !== undefined) continue;
  const r = await send(who[ch.by], `channel_${ch.slug}`, lobby, lobbyAbi as any, 'createChannel', [ch.name, ch.topic, ch.market], SECTION);
  let id: number | undefined;
  for (const log of r.logs) {
    try { const e = decodeEventLog({ abi: lobbyAbi, data: log.data, topics: log.topics }) as any; if (e.eventName === 'ChannelCreated') id = Number(e.args.channel); } catch { /* */ }
  }
  if (id === undefined) throw Error('ChannelCreated event missing');
  chId[ch.slug] = id;
  const x = load(); x.lobbyChannels = chId; save(x);
}
const join = (slug: string, n: Name) => step(`join_${slug}_${n}`, who[n], lobby, lobbyAbi, 'join', [BigInt(chId[slug]!)]);
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
/** The phone's copy flow: margin into KumiPerps, an IOC order at the touch + 0.5%, then the lobby checks the position. */
async function copyCall(slug: string, n: Name, label: string, callIndex: number, market: number, isLong: boolean, lev: number, margin: number) {
  const key = `copy_${slug}_${label}_${n}`;
  if (done.has(key)) return;
  const m = MARKETS[market]!;
  await step(`margin_${slug}_${label}_${n}`, who[n], perps, perpsAbi, 'deposit', [USD(margin)]);
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

for (const n of ['mika', 'sora', 'ren', 'bo'] as Name[]) await join('avaxpit', n);
for (const n of ['lia', 'bo', 'mika'] as Name[]) await join('btcdesk', n);
for (const n of ['jun', 'sora', 'ren', 'tae'] as Name[]) await join('newbies', n);

await lsay('avaxpit', 'jun', 1, 'AVAX pit is open. Calls only with a reason, please');
await lsay('avaxpit', 'mika', 1, 'Coinbase 1m candles show a higher low at 8.50');
const avaxCall = await lcall('avaxpit', 'mika', 'long1', 0, true, 3, 50, 'higher low at 8.50, invalid under 8.40');
await lsay('avaxpit', 'sora', 1, 'copying with 40, lower size');
await copyCall('avaxpit', 'sora', 'long1', avaxCall, 0, true, 3, 40);
await copyCall('avaxpit', 'ren', 'long1', avaxCall, 0, true, 3, 50);
await lsay('avaxpit', 'ren', 1, 'in. the copy card shows my real entry from the book');

await lsay('btcdesk', 'tae', 1, 'BTC desk rules: 2x or less, one idea a day');
const btcCall = await lcall('btcdesk', 'lia', 'long1', 1, true, 2, 60, 'range low, slow long');
await copyCall('btcdesk', 'bo', 'long1', btcCall, 1, true, 2, 60);
await lsay('btcdesk', 'bo', 1, 'copied from my phone wallet flow, 2x');

await lsay('newbies', 'lia', 1, 'Welcome! Tap Get test USDC, then copy any call. Its all Fuji testnet');
await lsay('newbies', 'tae', 1, 'gas on Fuji was 160 wei today. basically free');
await lsay('newbies', 'jun', 1, 'tip: the market tab has the live book and real candles');

const x2 = load();
x2.contracts.crews = x2.contracts.crews;
save(x2);
console.log('crews', crewAddr);
console.log('lobby', lobby, 'channels', chId);
