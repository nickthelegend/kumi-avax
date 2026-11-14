/**
 * Lists the KumiPerps markets in sdk MARKETS that the venue does not have yet (ETH-USD and LINK-USD, Nov 14 2026),
 * each on its real Chainlink Avalanche Fuji feed with the venue's usual parameters. Owner-only on KumiPerps.
 *   node fuji/list-markets.ts
 * The listing txs go under "txs" and the market table under contracts.markets in deployments/fuji.json.
 */
import { MARKETS, VENUE, perpsAbi } from '@kumi-avax/sdk';
import { account } from './env.ts';
import { load, pub, save, send } from './tx.ts';

const d = load();
const perps = d.contracts.perps as `0x${string}`;
const deployer = account('KUMI_DEPLOYER_KEY');
const have = Number(await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'marketCount' }));
for (const m of MARKETS.filter(x => x.id >= have)) {
  if (m.id !== Number(await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'marketCount' }))) throw Error(`${m.pair} would not get id ${m.id}`);
  await send(deployer, `list_${m.pair}`, perps, perpsAbi as any, 'listMarket', [m.pair, m.feed, m.maxAge, VENUE.imBps, VENUE.mmBps, VENUE.bandBps, VENUE.liqFeeBps, m.tick, m.lot]);
  const got = await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'getMarket', args: [m.id] });
  if (got.oracle.toLowerCase() !== m.feed.toLowerCase()) throw Error(`${m.pair} listed with oracle ${got.oracle}`);
  console.log(`listed ${m.pair} as market ${m.id} on ${m.feed}`);
}
const x = load();
x.contracts.markets = MARKETS.map(m => ({ id: m.id, pair: m.pair, chainlinkFeed: m.feed, heartbeatS: m.heartbeat, maxAgeS: m.maxAge, tick: m.tick.toString(), lot: m.lot.toString(), ...VENUE }));
save(x);
