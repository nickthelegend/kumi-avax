/**
 * Kumi's private balance on Fuji: deploys Ava Labs' EncryptedERC (converter over Kumi's TestUSDC, production
 * verifiers, 2 decimals) with its Registrar, sets a dedicated Kumi auditor account, then has Kumi's test accounts
 * open private balances and send real private tips for real copied calls in the public chats, plus a crew
 * settle-up, each posted in its chat as `kumi:private:<tx>`. Every transaction is recorded under "eerc" in
 * deployments/fuji.json. Keys come from the gitignored .env by name; nothing is printed.
 *
 *   node eerc/fuji.ts      (idempotent by label: reruns skip what is done)
 */
import { parseEther, type Abi, type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { FUJI_RPC, crewAbi, fuji, lobbyAbi, readChannelMessages, usdcAbi } from '@kumi-avax/sdk';
import { createPublicClient, http } from 'viem';
import { NO_REF, encryptedErcAbi, privateChatText, registeredKey } from '@kumi-avax/sdk/eerc';
import { account, ensureKeys, readEnv, ROOT } from '../fuji/env.ts';
import { load, save } from '../fuji/tx.ts';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { balanceOf, closeProver, deployVault, nodeProver, openKey, register, send, sendPrivately, shield, type Ctx, type Sent, type Vault } from './vault.ts';

ensureKeys();
if (!readEnv().KUMI_AUDITOR_KEY) appendFileSync(join(ROOT, '.env'), `KUMI_AUDITOR_KEY=${generatePrivateKey()}\n`, { mode: 0o600 });
const SECTION = 'eerc';
// One RPC for the whole run (no fallback), so reads and nonces come from the same node.
const fujiTransport = () => http(FUJI_RPC, { retryCount: 3, timeout: 30_000 });
const pub = createPublicClient({ chain: fuji, transport: fujiTransport() });
const record = (s: Sent) => { const d = load(); (d[SECTION] ??= []).push(s); save(d); };
const ctx: Ctx = { pub: pub as never, chain: fuji, transport: fujiTransport, log: [], onSent: record };
const done = new Set<string>((load()[SECTION] ?? []).map((t: { label: string }) => t.label));
const hashOf = (label: string) => ((load()[SECTION] ?? []) as Sent[]).find((t) => t.label === label)?.hash;

const deployer = account('KUMI_DEPLOYER_KEY') as unknown as PrivateKeyAccount;
const auditor = account('KUMI_AUDITOR_KEY' as never) as unknown as PrivateKeyAccount;
const who = {
  mika: account('KUMI_MIKA_KEY'), bo: account('KUMI_BO_KEY'), ren: account('KUMI_REN_KEY'),
  jun: account('KUMI_JUN_KEY'), sora: account('KUMI_SORA_KEY'), tae: account('KUMI_TAE_KEY'), lia: account('KUMI_LIA_KEY'),
} as unknown as Record<string, PrivateKeyAccount>;
const nameOf = (a: string) => Object.entries(who).find(([, x]) => x.address.toLowerCase() === a.toLowerCase())?.[0];

async function once(label: string, f: () => Promise<Sent | null>) {
  if (done.has(label)) return hashOf(label) ?? null;
  for (let attempt = 1; ; attempt++) {
    try { const s = await f(); done.add(label); return s?.hash ?? null; } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`retry ${label} (${(e as Error).message.split('\n')[0]})`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const d0 = load();
const usdc = d0.contracts.usdc as Address;
const lobby = d0.contracts.lobby as Address;

// 1. The eERC itself.
let v: Vault = d0.contracts.eerc;
if (!v) {
  v = await deployVault(ctx, deployer);
  const d = load(); d.contracts.eerc = v; save(d);
}
console.log('EncryptedERC', v.encryptedERC);

// 2. The auditor: its own Kumi test account, registered, then set by the owner.
const kAud = await openKey(auditor, fuji.id);
if ((await pub.getBalance({ address: auditor.address })) < parseEther('0.0002')) {
  const { createWalletClient } = await import('viem');
  const w = createWalletClient({ account: deployer, chain: fuji, transport: fujiTransport() });
  const t0 = Date.now();
  const hash = await w.sendTransaction({ to: auditor.address, value: parseEther('0.0003') });
  const r = await pub.waitForTransactionReceipt({ hash });
  record({ label: 'gas_auditor', from: deployer.address, to: auditor.address, hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), confirmMs: Date.now() - t0, at: new Date().toISOString() });
}
await once('auditor_register', () => register(ctx, v, auditor, kAud, nodeProver, 'auditor_register'));
await once('set_auditor', () => send(ctx, deployer, v.encryptedERC, encryptedErcAbi as Abi, 'setAuditorPublicKey', [auditor.address], 'set_auditor'));
{ const d = load(); d.accounts.auditor = auditor.address; save(d); }

// 3. Test accounts open private balances and shield a little tUSDC.
const keys: Record<string, Awaited<ReturnType<typeof openKey>>> = {};
const shieldUnits: Record<string, bigint> = { mika: 2500n, bo: 2000n, ren: 1500n, jun: 2000n, sora: 1500n, tae: 1000n, lia: 1000n };
for (const [n, a] of Object.entries(who)) {
  keys[n] = await openKey(a, fuji.id);
  await once(`register_${n}`, () => register(ctx, v, a, keys[n]!, nodeProver, `register_${n}`));
  const units = shieldUnits[n]!;
  const pubBal = await pub.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [a.address] });
  if (!done.has(`shield_${n}`) && pubBal < units * 10_000n) await once(`faucet_${n}`, () => send(ctx, a, usdc, usdcAbi as Abi, 'faucet', [], `faucet_${n}`));
  await once(`shield_${n}`, () => shield(ctx, v, a, keys[n]!, usdc, units, `shield_${n}`));
}

// 4. Private tips for real copies of real calls in the public chats.
type Tip = { channel: number; label: string; from: string; to: string; call: number; units: bigint };
const tips: Tip[] = [];
for (const channel of [0, 1, 2]) {
  const msgs = await readChannelMessages(pub as never, lobby, channel, 200);
  for (const m of msgs.filter((x) => x.kind === 'copy')) {
    const call = msgs.find((x) => x.index === m.ref && x.kind === 'call');
    const from = nameOf(m.who); const to = call && nameOf(call.who);
    if (!from || !to || from === to) continue;
    tips.push({ channel, label: `tip_c${channel}_call${m.ref}_${from}`, from, to, call: m.ref, units: BigInt(100 + 25 * (tips.length % 4)) });
  }
}
console.log(`${tips.length} copies to tip`, tips.map((t) => `${t.from}->${t.to} #${t.call}`).join(', '));
for (const t of tips.slice(0, 5)) {
  if (!(await registeredKey(pub as never, v.registrar, who[t.to]!.address))) continue;
  const hash = await once(t.label, () => sendPrivately(ctx, v, who[t.from]!, keys[t.from]!, usdc, who[t.to]!.address, t.units,
    { kind: 'tip', venue: lobby, channel: BigInt(t.channel), ref: BigInt(t.call) }, nodeProver, t.label));
  if (hash) await once(`${t.label}_post`, () => send(ctx, who[t.from]!, lobby, lobbyAbi as Abi, 'say', [BigInt(t.channel), privateChatText(hash as Hex)], `${t.label}_post`));
}

// 5. A crew settle-up: bo pays mika back privately inside Night Owls.
const nightOwls = (d0.contracts.crews as { name: string; address: Address }[]).find((c) => c.name === 'Night Owls')!.address;
const settle = await once('send_nightowls_bo_mika', () => sendPrivately(ctx, v, who.bo!, keys.bo!, usdc, who.mika!.address, 300n,
  { kind: 'send', venue: nightOwls, channel: 0n, ref: NO_REF }, nodeProver, 'send_nightowls_bo_mika'));
if (settle) await once('send_nightowls_bo_mika_post', () => send(ctx, who.bo!, nightOwls, crewAbi as Abi, 'say', [privateChatText(settle as Hex)], 'send_nightowls_bo_mika_post'));

for (const n of Object.keys(who)) console.log(`${n.padEnd(5)} private ${(Number((await balanceOf(ctx, v, who[n]!.address, keys[n]!, usdc)).balance) / 100).toFixed(2)}`);
await closeProver();
process.exit(0);
