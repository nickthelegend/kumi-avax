/**
 * One crew action from a Kumi test account, for demos where a phone holds another member: a pitch or a vote,
 * sent on Fuji and logged in deployments/fuji.json (section `crewActs`). Keys come from .env by name; none is printed.
 *   node fuji/crew-act.ts <member> pitch <crew> "/long AVAX 2x 10%"
 *   node fuji/crew-act.ts <member> vote <crew> <id> yes|no
 *   node fuji/crew-act.ts - state <crew>           shares, NAV and the last pitch with its tally
 * <member> is a test account name (lia, sora, …); <crew> is a crew address or a slug from deployments/fuji.json.
 */
import { formatUnits, type Address } from 'viem';
import { crewAbi, parseCommand, describe } from '@kumi-avax/sdk';
import { account, type Role } from './env.ts';
import { load, pub, send } from './tx.ts';

const [who, verb, crewArg, ...rest] = process.argv.slice(2);
if (!who || !verb || !crewArg) throw Error('usage: crew-act.ts <member|-> pitch|vote|state <crew> …');
const d = load();
const crews: any[] = d.contracts.crews;
const crew = (crewArg.startsWith('0x') ? crewArg : crews.find(c => c.slug === crewArg || c.name.toLowerCase().replace(/\s+/g, '') === crewArg)?.address) as Address;
if (!crew) throw Error(`No crew ${crewArg} in deployments/fuji.json`);
const names: Record<string, string> = Object.fromEntries(Object.entries(d.accounts).map(([k, v]) => [(v as string).toLowerCase(), k]));

async function state() {
  const [name, members, total, nav, count] = await Promise.all(['name', 'members', 'totalShares', 'nav', 'proposalCount']
    .map(f => pub.readContract({ address: crew, abi: crewAbi, functionName: f as any }))) as [string, Address[], bigint, bigint, bigint];
  const shares = await Promise.all(members.map(m => pub.readContract({ address: crew, abi: crewAbi, functionName: 'shares', args: [m] }) as Promise<bigint>));
  console.log(`${name} ${crew} NAV ${formatUnits(nav, 6)} tUSDC, proposals ${count}`);
  members.forEach((m, i) => console.log(`  ${names[m.toLowerCase()] ?? m} ${(Number(shares[i]! * 10000n / total) / 100).toFixed(1)}% of shares`));
  if (count > 0n) {
    const id = count - 1n;
    const [p, t] = await Promise.all([
      pub.readContract({ address: crew, abi: crewAbi, functionName: 'getProposal', args: [id] }) as Promise<any>,
      pub.readContract({ address: crew, abi: crewAbi, functionName: 'tally', args: [id] }) as Promise<readonly [bigint, bigint, bigint]>,
    ]);
    console.log(`  last #${id} "${p.note}" by ${names[p.proposer.toLowerCase()]}: yes ${(Number(t[0] * 10000n / total) / 100).toFixed(1)}%, needs ${(Number(t[2] * 10000n / total) / 100).toFixed(2)}%, executed ${p.executed}, filled ${formatUnits(p.filled, 18)}`);
  }
}

if (verb === 'state') await state();
else {
  const acct = account(`KUMI_${who.toUpperCase()}_KEY` as Role);
  const section = 'crewActs';
  if (verb === 'pitch') {
    const parsed = parseCommand(rest.join(' '), 5);
    if (!parsed || !parsed.ok || parsed.cmd.kind !== 'open' || parsed.cmd.captain) throw Error(`Not an open pitch: ${rest.join(' ')}`);
    const c = parsed.cmd;
    await send(acct, `${who} pitch ${describe(c)}`, crew, crewAbi as any, 'pitch', [0, c.market, c.isLong, c.leverage, c.sizeBps, '0x0000000000000000000000000000000000000000', describe(c)], section);
  } else if (verb === 'vote') {
    const [id, yn] = rest;
    if (id === undefined || !['yes', 'no'].includes(yn ?? '')) throw Error('vote needs <id> yes|no');
    await send(acct, `${who} vote ${yn} #${id}`, crew, crewAbi as any, 'vote', [BigInt(id), yn === 'yes'], section);
  } else throw Error(`Unknown action ${verb}`);
  await state();
}
