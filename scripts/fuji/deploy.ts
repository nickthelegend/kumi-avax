/**
 * Deploys Kumi on Fuji: TestUSDC, the KumiPerps venue with AVAX-USD and BTC-USD on the real Chainlink feeds,
 * the KumiCrew implementation and factory. Then it mints the maker's inventory, gives each member faucet tUSDC
 * and creates the "Night Owls" crew (mika captain, bo, ren). Addresses and every tx go to deployments/fuji.json.
 */
import { MARKETS, VENUE } from '@kumi-avax/sdk';
import { account } from './env.ts';
import { artifact, deploy, load, save, send } from './tx.ts';

const d = load();
const deployer = account('KUMI_DEPLOYER_KEY');
const maker = account('KUMI_MAKER_KEY');
const members = [account('KUMI_MIKA_KEY'), account('KUMI_BO_KEY'), account('KUMI_REN_KEY')];

const usdcA = artifact('TestUSDC.sol', 'TestUSDC');
const perpsA = artifact('KumiPerps.sol', 'KumiPerps');
const crewA = artifact('KumiCrew.sol', 'KumiCrew');
const factoryA = artifact('KumiCrew.sol', 'KumiCrewFactory');

const c = (d.contracts ??= {});
const save1 = (k: string, v: unknown) => { const x = load(); x.contracts[k] = v; save(x); c[k] = v; };

if (!c.usdc) save1('usdc', await deploy(deployer, 'deploy_TestUSDC', usdcA.abi, usdcA.bytecode));
if (!c.perps) save1('perps', await deploy(deployer, 'deploy_KumiPerps', perpsA.abi, perpsA.bytecode, [c.usdc]));
if (!c.markets) {
  for (const m of MARKETS) {
    await send(deployer, `list_${m.pair}`, c.perps, perpsA.abi, 'listMarket', [m.pair, m.feed, m.maxAge, VENUE.imBps, VENUE.mmBps, VENUE.bandBps, VENUE.liqFeeBps, m.tick, m.lot]);
  }
  save1('markets', MARKETS.map(m => ({ id: m.id, pair: m.pair, chainlinkFeed: m.feed, heartbeatS: m.heartbeat, maxAgeS: m.maxAge, tick: m.tick.toString(), lot: m.lot.toString(), ...VENUE })));
}
if (!c.crewImplementation) save1('crewImplementation', await deploy(deployer, 'deploy_KumiCrew_implementation', crewA.abi, crewA.bytecode));
if (!c.factory) save1('factory', await deploy(deployer, 'deploy_KumiCrewFactory', factoryA.abi, factoryA.bytecode, [c.perps, c.crewImplementation]));

if (!c.seeded) {
  await send(deployer, 'mint_maker_inventory', c.usdc, usdcA.abi, 'mint', [maker.address, 250_000n * 10n ** 6n]);
  await send(deployer, 'fund_insurance_mint', c.usdc, usdcA.abi, 'mint', [deployer.address, 5_000n * 10n ** 6n]);
  await send(deployer, 'approve_insurance', c.usdc, usdcA.abi, 'approve', [c.perps, 5_000n * 10n ** 6n]);
  await send(deployer, 'fund_insurance', c.perps, perpsA.abi, 'fundInsurance', [5_000n * 10n ** 6n]);
  for (const [i, m] of members.entries()) await send(m, `faucet_${['mika', 'bo', 'ren'][i]}`, c.usdc, usdcA.abi, 'faucet');
  save1('seeded', true);
}

if (!c.crews?.length) {
  const policy = { thresholdBps: 5001, votingPeriod: 86400, maxLeverage: 5, maxSlippageBps: 100, captainMaxLeverage: 2, captainMaxBps: 1000, captainTradesPerDay: 2 };
  const r = await send(members[0]!, 'create_crew_night_owls', c.factory, factoryA.abi, 'createCrew', ['Night Owls', members.map(m => m.address), members[0]!.address, policy]);
  const { decodeEventLog } = await import('viem');
  let crew: string | undefined;
  for (const log of r.logs) {
    try { const e = decodeEventLog({ abi: factoryA.abi, data: log.data, topics: log.topics }) as any; if (e.eventName === 'CrewCreated') crew = e.args.crew; } catch { /* other events */ }
  }
  if (!crew) throw Error('CrewCreated event missing');
  save1('crews', [{ name: 'Night Owls', address: crew, policy, members: { mika: members[0]!.address, bo: members[1]!.address, ren: members[2]!.address }, captain: 'mika' }]);
}
const x = load();
x.accounts = { deployer: deployer.address, maker: maker.address, mika: members[0]!.address, bo: members[1]!.address, ren: members[2]!.address };
save(x);
console.log(JSON.stringify(x.contracts, null, 2));
