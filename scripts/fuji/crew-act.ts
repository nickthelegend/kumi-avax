/**
 * One crew action from a Kumi test account, for demos where a phone holds another member: a pitch or a vote,
 * sent on Fuji and logged in deployments/fuji.json (section `crewActs`). Keys come from .env by name; none is printed.
 *   node fuji/crew-act.ts <member> pitch <crew> "/long AVAX 2x 10%"
 *   node fuji/crew-act.ts <member> vote <crew> <id> yes|no
 *   node fuji/crew-act.ts - state <crew>           shares, NAV and the last pitch with its tally
 *   node fuji/crew-act.ts <member> joincode <crew>   prints the member's join code (kumi://invite/<crew>/<address>, public)
 *   node fuji/crew-act.ts <member> chipin <crew> <tUSDC>        approve once + deposit into the crew vault
 *   node fuji/crew-act.ts <member> copy <channel> <call index> <margin tUSDC>   copy a lobby call: margin into
 *        KumiPerps, an IOC order on the live book, then KumiLobby.copy (the lobby checks the position)
 * <member> is a test account name (lia, sora, …); <crew> is a crew address or a slug from deployments/fuji.json.
 */
import { formatUnits, parseUnits, type Address } from 'viem';
import { MARKETS, crewAbi, encodeOrder, initialMargin, lobbyAbi, parseCommand, perpsAbi, describe, sizeFor, usdcAbi } from '@kumi-avax/sdk';
import { account, type Role } from './env.ts';
import { load, pub, send } from './tx.ts';

const [who, verb, crewArg, ...rest] = process.argv.slice(2);
if (!who || !verb || !crewArg) throw Error('usage: crew-act.ts <member|-> pitch|vote|state <crew> …');
const d = load();
const crews: any[] = d.contracts.crews;
const crew = (verb === 'copy' ? '0x0000000000000000000000000000000000000000' : crewArg.startsWith('0x') ? crewArg : crews.find(c => c.slug === crewArg || c.name.toLowerCase().replace(/\s+/g, '') === crewArg)?.address) as Address;
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

const MAX = 2n ** 256n - 1n;
if (verb === 'state') await state();
else if (verb === 'joincode') {
  const acct = account(`KUMI_${who.toUpperCase()}_KEY` as Role);
  console.log(`kumi://invite/${crew}/${acct.address}`);
} else if (verb === 'chipin') {
  const acct = account(`KUMI_${who.toUpperCase()}_KEY` as Role);
  const amount = parseUnits(rest[0] ?? '0', 6);
  if (amount <= 0n) throw Error('chipin needs an amount in tUSDC');
  const usdc = d.contracts.usdc as Address;
  const allowance = await pub.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [acct.address, crew] }) as bigint;
  if (allowance < amount) await send(acct, `${who} approve tUSDC for ${crew}`, usdc, usdcAbi as any, 'approve', [crew, MAX], 'crewActs');
  await send(acct, `${who} chip in ${rest[0]} tUSDC`, crew, crewAbi as any, 'deposit', [amount], 'crewActs');
  await state();
} else if (verb === 'copy') {
  const acct = account(`KUMI_${who.toUpperCase()}_KEY` as Role);
  const channel = BigInt(crewArg);
  const index = BigInt(rest[0] ?? '-1');
  const margin = parseUnits(rest[1] ?? '25', 6);
  const lobby = d.contracts.lobby as Address, perps = d.contracts.perps as Address, usdc = d.contracts.usdc as Address;
  const msg = await pub.readContract({ address: lobby, abi: lobbyAbi, functionName: 'getMessage', args: [channel, index] }) as any;
  const m = MARKETS[Number(msg.market)]!;
  const [info, oracle] = await Promise.all([
    pub.readContract({ address: perps, abi: perpsAbi, functionName: 'getMarket', args: [m.id] }) as Promise<any>,
    pub.readContract({ address: perps, abi: perpsAbi, functionName: 'oraclePrice', args: [m.id] }) as Promise<readonly [bigint, bigint]>,
  ]);
  const touch = msg.isLong ? info.bestAsk : info.bestBid;
  const size = sizeFor(m, margin, Number(msg.leverage), touch || oracle[0]);
  const im = initialMargin(size, touch || oracle[0]);
  const need = margin > im + im / 5n ? margin : im + im / 5n;
  const [eq, req] = await pub.readContract({ address: perps, abi: perpsAbi, functionName: 'health', args: [acct.address] }).catch(() => [0n, 0n, 0n]) as readonly [bigint, bigint, bigint];
  const free = eq - BigInt(req);
  if (free < need) {
    const gap = need - (free > 0n ? free : 0n);
    const allowance = await pub.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [acct.address, perps] }) as bigint;
    if (allowance < gap) await send(acct, `${who} approve tUSDC for KumiPerps`, usdc, usdcAbi as any, 'approve', [perps, MAX], 'crewActs');
    await send(acct, `${who} margin ${formatUnits(gap, 6)} tUSDC`, perps, perpsAbi as any, 'deposit', [gap], 'crewActs');
  }
  const args = encodeOrder({ market: m.id, isBuy: !!msg.isLong, kind: 'market', size }, { touch, oracle: oracle[0] });
  const r = await send(acct, `${who} copy order ${msg.isLong ? 'long' : 'short'} ${formatUnits(size, 18)} ${m.symbol}`, perps, perpsAbi as any, 'placeOrder', [...args], 'crewActs');
  await send(acct, `${who} copy #${index} in channel ${channel}`, lobby, lobbyAbi as any, 'copy', [channel, index, r.transactionHash], 'crewActs');
} else {
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
