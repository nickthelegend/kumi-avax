/**
 * Funds the Kumi test accounts with Fuji AVAX for gas.
 *  1. From an already-funded Fuji key in another local repo's env file (KUMI_FUNDER_ENV = path,
 *     KUMI_FUNDER_VAR = variable name; read here, never printed or copied) send KUMI_FUND_AVAX to the deployer.
 *  2. From the deployer, top up the maker and the three members.
 */
import { formatEther, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { account, readEnv } from './env.ts';
import { pub, transfer } from './tx.ts';

const targets: Record<string, string> = { KUMI_MAKER_KEY: '0.01', KUMI_MIKA_KEY: '0.0015', KUMI_BO_KEY: '0.0015', KUMI_REN_KEY: '0.0015' };
const deployer = account('KUMI_DEPLOYER_KEY');
const want = parseEther(process.env.KUMI_FUND_AVAX ?? '0.05');
const have = await pub.getBalance({ address: deployer.address });
if (have < want / 2n) {
  const file = process.env.KUMI_FUNDER_ENV;
  const name = process.env.KUMI_FUNDER_VAR ?? 'PRIVATE_KEY';
  if (!file) throw Error('Setup required: KUMI_FUNDER_ENV (path to an env file holding a funded Fuji key)');
  const key = readEnv(file)[name];
  if (!key) throw Error(`Setup required: ${name} in the funder env file`);
  const funder = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex);
  console.log(`funder ${funder.address} balance ${formatEther(await pub.getBalance({ address: funder.address }))} AVAX`);
  await transfer(funder, 'fund_deployer', deployer.address, want - have);
}
for (const [role, amount] of Object.entries(targets)) {
  const a = account(role as never);
  const bal = await pub.getBalance({ address: a.address });
  const target = parseEther(amount);
  if (bal < target) await transfer(deployer, `gas_${role.replace(/^KUMI_|_KEY$/g, '').toLowerCase()}`, a.address, target - bal);
}
console.log(`deployer left ${formatEther(await pub.getBalance({ address: deployer.address }))} AVAX`);
