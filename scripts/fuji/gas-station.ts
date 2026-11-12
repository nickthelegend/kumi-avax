/**
 * Kumi v2.2 gas-free start on Fuji: deploys KumiGasStation (owner = Kumi's deployer, relayer = a dedicated Kumi
 * sponsor key that only Kumi's API holds), then funds it modestly from Kumi's own test accounts.
 *   node fuji/gas-station.ts            deploy (once) and fund up to KUMI_STATION_TARGET (default 0.006 AVAX)
 * Keys are read by name from the repo's gitignored .env; nothing here prints one. A missing KUMI_SPONSOR_KEY is
 * created once (appended to .env, mode 600).
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatEther, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { account, readEnv, ROOT } from './env.ts';
import { artifact, deploy, load, pub, record, save, transfer } from './tx.ts';

const ENV = join(ROOT, '.env');
if (!readEnv().KUMI_SPONSOR_KEY) appendFileSync(ENV, `KUMI_SPONSOR_KEY=${generatePrivateKey()}\n`, { mode: 0o600 });
const sponsor = privateKeyToAccount(readEnv().KUMI_SPONSOR_KEY as Hex);
const deployer = account('KUMI_DEPLOYER_KEY');

const DRIP = parseEther('0.0002');
const DAILY_CAP = 20;
const PER_TAG = 3;
const target = parseEther(process.env.KUMI_STATION_TARGET ?? '0.006');

const d = load();
d.accounts = { ...d.accounts, sponsor: sponsor.address };
save(d);

let station = d.contracts.gasStation as `0x${string}` | undefined;
if (!station) {
  const a = artifact('KumiGasStation.sol', 'KumiGasStation');
  station = await deploy(deployer, 'deploy_KumiGasStation', a.abi, a.bytecode, [sponsor.address, DRIP, DAILY_CAP, PER_TAG]);
  const x = load();
  x.contracts.gasStation = station;
  x.contracts.gasStationConfig = { dripAvax: formatEther(DRIP), dailyCap: DAILY_CAP, perRequesterDaily: PER_TAG, relayer: sponsor.address, owner: deployer.address };
  save(x);
  // move the deploy record into the v2.2 section
  const y = load();
  const rec = y.txs.pop();
  save(y);
  record(rec, 'gasStation');
}

// Fund from Kumi's own test accounts, leaving each with gas for its own seeding (Fuji gas is ~160 wei).
const KEEP = parseEther('0.0008');
for (const role of ['KUMI_MIKA_KEY', 'KUMI_BO_KEY'] as const) {
  const have = await pub.getBalance({ address: station });
  if (have >= target) break;
  const from = account(role);
  const bal = await pub.getBalance({ address: from.address });
  const give = bal - KEEP < target - have ? bal - KEEP : target - have;
  if (give <= 0n) continue;
  const r = await transfer(from, `fund_gas_station_${role.replace(/^KUMI_|_KEY$/g, '').toLowerCase()}`, station, give);
  const z = load(); const t = z.txs.pop(); save(z); record(t, 'gasStation'); void r;
}
// The relayer pays the drip txs' own gas.
const sBal = await pub.getBalance({ address: sponsor.address });
if (sBal < parseEther('0.0001')) {
  await transfer(account('KUMI_REN_KEY'), 'gas_sponsor_relayer', sponsor.address, parseEther('0.0002') - sBal);
  const z = load(); const t = z.txs.pop(); save(z); record(t, 'gasStation');
}
console.log(`station ${station} holds ${formatEther(await pub.getBalance({ address: station }))} AVAX (${Number(await pub.getBalance({ address: station }) / DRIP)} drips); relayer ${sponsor.address} holds ${formatEther(await pub.getBalance({ address: sponsor.address }))}`);
