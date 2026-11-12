/**
 * The private balance on the phone, end to end on Fuji, through the Expo web build at 375 x 812, with a NEW wallet
 * made in the app: maker sends it 0.0002 AVAX for gas (outside the app) -> Get test USDC -> Open private balance
 * (registration proof made in the page) -> Move 20.00 in -> join the AVAX pit and copy mika's call -> Tip mika
 * privately (transfer proof made in the page) -> the tip card shows the amount to this phone only -> Move 5.00 out
 * (withdraw proof). Every tx the app signs is recorded under "phonePrivate" in deployments/fuji.json.
 *   node qa/serve.mjs ../mobile/dist 5352 &  node qa/phone-private.mjs http://127.0.0.1:5352
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, fujiTransport } from '@kumi-avax/sdk';
import { ROOT, withBrowser } from './harness.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5352';
const OUT = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/v2.1';
mkdirSync(OUT, { recursive: true });
function envKey(name) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] === name) return m[2];
  }
  throw Error(`Setup required: ${name} in .env`);
}
const pub = createPublicClient({ chain: fuji, transport: fujiTransport() });
async function fundGas(to) {
  const maker = privateKeyToAccount(envKey('KUMI_MAKER_KEY'));
  const w = createWalletClient({ account: maker, chain: fuji, transport: fujiTransport() });
  const hash = await w.sendTransaction({ to, value: parseEther('0.0002') });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`gas 0.0002 AVAX -> ${to} ${hash} (maker left ${formatEther(await pub.getBalance({ address: maker.address }))})`);
  return hash;
}

await withBrowser(async browser => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', x => errors.push(String(x)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async name => { await page.waitForTimeout(900); await page.screenshot({ path: join(OUT, `phone-${name}.png`) }); console.log(`shot phone-${name}.png`); };
  const tid = id => page.locator(`[data-testid="${id}"]`).first();
  const waitText = (t, timeout = 90_000, exact = false) => page.getByText(t, { exact }).first().waitFor({ timeout });
  // Resolves when `ok` does; fails (with a screenshot) if an error notice shows up first. Stale watchers are disarmed.
  const until = async (label, ok) => {
    let armed = true;
    const bad = page.locator('[role="alert"]').first().waitFor({ timeout: 300_000 }).then(async () => {
      if (!armed) return new Promise(() => {});
      await shot(`p-error-${label}`);
      throw Error(`${label} failed in the app: ${await page.locator('[role="alert"]').first().textContent()}`);
    }, () => new Promise(() => {}));
    try { return await Promise.race([ok, bad]); } finally { armed = false; }
  };
  const t0 = Date.now();
  const timed = async (label, p) => { const s = Date.now(); await p; console.log(`${label}: ${((Date.now() - s) / 1000).toFixed(1)} s`); };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitText('Your group chat is a fund');
  await tid('create-wallet').click();
  await waitText('Wallet ready');
  const address = (await page.getByText(/^0x[0-9a-fA-F]{40}$/).first().textContent()).trim();
  console.log(`phone wallet ${address}`);
  const gasTx = await fundGas(address);
  await tid('finish-onboarding').click();
  await waitText('Your chats');

  await tid('tab-wallet').click();
  await waitText('Private balance');
  await tid('get-usdc').click();
  await waitText('Test USDC from the faucet', 120_000);
  await page.waitForTimeout(3000);
  await shot('p01-wallet-private-closed');
  await tid('open-private').click();
  await timed('open (registration proof + tx)', until('open', waitText('Move in', 240_000, true)));
  await shot('p02-private-open');
  await tid('private-in').click();
  await tid('move-amount').fill('20.00');
  await shot('p03-move-in-sheet');
  await tid('confirm-move').click();
  await timed('move in', until('move-in', page.getByText('Move 20.00 in ·').first().waitFor({ timeout: 180_000 })));
  await page.waitForTimeout(4000);
  await shot('p04-private-20');

  await tid('tab-index').click();
  await waitText('Public lobby');
  await tid('join-0').click();
  await waitText('Live on Fuji', 120_000);
  await waitText('CALLED', 90_000);
  await page.locator('[data-testid^="copy-"]').first().click();
  await tid('confirm-copy').click();
  await until('copy', waitText('Copied on the book', 240_000, true));
  await page.getByText('Back to the chat').click();
  await page.locator('[data-testid^="tip-"]').first().waitFor({ timeout: 90_000 });
  await shot('p05-call-tip-button');
  await page.locator('[data-testid^="tip-"]').first().click();
  await tid('private-amount').fill('1.50');
  await page.waitForTimeout(2500);
  await shot('p06-tip-sheet');
  await tid('confirm-private').click();
  await timed('tip (transfer proof + 2 txs)', until('tip', waitText('Sent privately', 300_000, true)));
  await shot('p07-tip-sent');
  await page.getByText('Back to the chat').click();
  await page.getByText('+1.50').first().waitFor({ timeout: 60_000 }).catch(() => {});
  await page.getByText(/^1\.50$/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await shot('p08-tip-card-sender');

  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
  await waitText('Decrypted on this phone', 90_000);
  await tid('private-out').click();
  await tid('move-amount').fill('5.00');
  await tid('confirm-move').click();
  await timed('move out (withdraw proof + tx)', until('move-out', page.getByText('Move 5.00 out ·').first().waitFor({ timeout: 240_000 })));
  await page.waitForTimeout(3000);
  await shot('p09-private-after-out');

  const activity = await page.evaluate(() => JSON.parse(localStorage.getItem('kumi.activity.v1') ?? '[]'));
  console.log(`${activity.length} txs signed in the app in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const f = join(ROOT, 'deployments/fuji.json');
  const d = JSON.parse(readFileSync(f, 'utf8'));
  (d.phonePrivate ??= []).push({ at: new Date().toISOString(), wallet: address, gasFromMaker: gasTx, signedInApp: activity.slice().reverse().map(a => ({ label: a.label, hash: a.hash })) });
  (d.phoneQaWallets ??= {})[`phone-qa-${Object.keys(d.phoneQaWallets).length + 1}`] = address;
  writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
  const real = errors.filter(e => !/favicon|DevTools|Download the React DevTools/.test(e));
  console.log(real.length ? `console errors:\n${real.join('\n')}` : 'no console errors');
  await ctx.close();
});
