/**
 * The phone app, end to end on Fuji, through its Expo web build at phone size (375 x 812):
 *   onboarding creates a NEW wallet in the app -> the maker test account sends it 0.002 AVAX for gas (the only
 *   step outside the app; the public faucet needs a captcha) -> Get test USDC (TestUSDC.faucet, signed in the app)
 *   -> join the AVAX pit (KumiLobby.join) -> copy mika's call (approve, deposit, IOC order, KumiLobby.copy)
 *   -> send a chat message -> Market tab: book, candles, position -> a BTC limit order -> crew room -> invite QR.
 * Every tx the app signs is read back from the app's own activity log and recorded under "phoneDemo" in
 * deployments/fuji.json. Screenshots go to orchestration/shots/avax-kumi/v2/.
 *   node qa/phone.mjs [http://127.0.0.1:5352]   (serve mobile/dist first: node qa/serve.mjs ../mobile/dist 5352)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fuji, fujiTransport } from '@kumi-avax/sdk';
import { ROOT, withBrowser } from './harness.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5352';
const OUT = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/v2';
mkdirSync(OUT, { recursive: true });
const only = process.argv.includes('--shots-only');

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
  const bal = await pub.getBalance({ address: to });
  if (bal >= parseEther('0.0001')) return null;
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
  const shot = async (name, full = false) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `phone-${name}.png`), fullPage: full });
    console.log(`shot phone-${name}.png`);
  };
  const tid = id => page.locator(`[data-testid="${id}"]`).first();
  const waitText = (t, timeout = 90_000, exact = false) => page.getByText(t, { exact }).first().waitFor({ timeout });
  const fullShot = async name => {
    // RN-web scrolls inside a div, so a full-page shot is the viewport grown by the scroller's hidden height.
    await page.waitForTimeout(900);
    const extra = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(d).overflowY));
      return els.reduce((m, d) => Math.max(m, d.scrollHeight - d.clientHeight), 0);
    });
    await page.setViewportSize({ width: 375, height: Math.min(812 + extra, 6000) });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `phone-${name}.png`) });
    console.log(`shot phone-${name}.png (full)`);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitText('Your group chat is a fund');
  await shot('01-onboarding');
  await tid('create-wallet').click();
  await waitText('Wallet ready');
  const address = (await page.getByText(/^0x[0-9a-fA-F]{40}$/).first().textContent()).trim();
  console.log(`phone wallet ${address}`);
  await shot('02-wallet-ready');
  const gasTx = only ? null : await fundGas(address);
  await tid('finish-onboarding').click();
  await waitText('Your chats');
  await waitText('Public lobby');
  await shot('03-chats-new-user');
  await fullShot('03-chats-new-user-full');

  // Wallet: faucet signed in the app
  await tid('tab-wallet').click();
  await waitText('Deposit');
  if (!only) {
    await tid('get-usdc').click();
    await waitText('Test USDC from the faucet', 120_000);
  }
  await page.waitForTimeout(6000);
  await shot('04-wallet');
  await fullShot('04-wallet-full');

  // Join the AVAX pit from the lobby and copy mika's call
  await tid('tab-index').click();
  await waitText('Public lobby');
  if (!only) {
    await tid('join-0').click();
    await waitText('Live on Fuji', 120_000);
  } else {
    await page.goto(`${BASE}/chat/l-0`, { waitUntil: 'networkidle' });
  }
  await waitText('CALLED', 90_000);
  await shot('05-chat-avax-pit');
  if (!only) {
    await page.locator('[data-testid^="copy-"]').first().click();
    await waitText('Sign on this phone and copy');
    await shot('06-copy-sheet');
    await tid('confirm-copy').click();
    await Promise.race([
      waitText('Copied on the book', 240_000, true),
      page.locator('[role="alert"]').first().waitFor({ timeout: 240_000 }).then(async () => { await shot('07-copy-error'); throw Error(`copy failed in the app: ${await page.locator('[role="alert"]').first().textContent()}`); }),
    ]);
    await shot('07-copied');
    await page.getByText('Back to the chat').click();
    await tid('composer').fill('copied from my phone. entry is on the card, straight from KumiPerps');
    await tid('send').click();
    await waitText('Sent on Fuji', 120_000);
    await page.waitForTimeout(5000);
  }
  await shot('08-chat-after-copy');

  // Market
  await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
  await waitText('Order book');
  await page.getByText('real data').first().waitFor();
  await page.waitForTimeout(5000);
  await shot('09-market');
  await fullShot('09-market-full');
  await tid('market-BTC').click();
  await page.waitForTimeout(6000);
  if (!only) {
    await tid('side-buy').click();
    await page.getByText('Limit', { exact: true }).click();
    await tid('margin').fill('20');
    // a resting limit 1% under Chainlink (read from the chain here), so it rests as this phone's open order
    const [o] = await pub.readContract({ address: '0x6a6c0d74862edb85f2f0534381857347d5ae09a3', abi: [{ type: 'function', name: 'oraclePrice', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] }], functionName: 'oraclePrice', args: [1] });
    const px = Math.floor((Number(o) / 1e8) * 0.99);
    await tid('limit-price').fill(String(px));
    await tid('place-order').click();
    await waitText('Placing the limit order', 60_000).catch(() => {});
    await page.getByText('Buy BTC').first().waitFor({ timeout: 150_000 });
    await page.waitForTimeout(6000);
  }
  await fullShot('10-market-btc-order');

  // A crew room (watch-only for a new wallet) and the join-code QR
  await page.goto(`${BASE}/chat/c-0x16e639793291e35db63fc411ffe97da76f35eb2b`, { waitUntil: 'networkidle' });
  await waitText('PITCHED', 90_000);
  await shot('11-crew-room');
  await page.getByText('Show my join code').click();
  await waitText('Your join code');
  await shot('12-join-code');
  await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
  await waitText('Paste a link');
  await shot('13-scan');

  // Final wallet with activity
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
  await waitText('Signed on this phone');
  await page.waitForTimeout(6000);
  await fullShot('14-wallet-after');

  const activity = await page.evaluate(() => JSON.parse(localStorage.getItem('kumi.activity.v1') ?? '[]'));
  console.log(`${activity.length} txs signed in the app`);
  if (!only) {
    const f = join(ROOT, 'deployments/fuji.json');
    const d = JSON.parse(readFileSync(f, 'utf8'));
    (d.phoneRuns ??= []).push({ at: new Date().toISOString(), wallet: address, gasFromMaker: gasTx, signedInApp: activity.slice().reverse().map(a => ({ label: a.label, hash: a.hash })) });
    writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
  }
  const real = errors.filter(e => !/favicon|DevTools|Download the React DevTools/.test(e));
  console.log(real.length ? `console errors:\n${real.join('\n')}` : 'no console errors');
  await ctx.close();
});
