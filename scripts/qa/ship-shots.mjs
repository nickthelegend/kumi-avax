/**
 * Ship round: screenshots of every hosted screen, nothing injected. The only txs are the phone's real gas-free
 * start for a brand-new in-page wallet (one KumiGasStation drip, then the test USDC faucet).
 *  - web at 1440 and 375: every route, plus a 404
 *  - phone build at 375: onboarding (signed out), then a fresh in-page wallet and every tab and sheet route
 * Prints one JSON line per screen with sideways overflow and console errors; exits 1 if any screen fails.
 *   node qa/ship-shots.mjs [before|after]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withBrowser } from './harness.mjs';

const tag = process.argv[2] ?? 'after';
const WEB = process.env.WEB ?? 'https://kumi-avax-web.vercel.app';
const APP = process.env.APP ?? 'https://kumi-avax-app.vercel.app';
const OUT = join(process.env.SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/ship', tag);
mkdirSync(OUT, { recursive: true });
const CREW = '0x16e639793291e35db63fc411ffe97da76f35eb2b';
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const ignore = e => /favicon|DevTools|expo-notifications|Download the React DevTools/.test(e);
let failed = false;

const report = (name, overflow, errors) => {
  const real = errors.filter(e => !ignore(e));
  const ok = overflow <= 0 && real.length === 0;
  if (!ok) failed = true;
  console.log(JSON.stringify({ name, ok, overflow, errors: real.slice(0, 3) }));
};

const webRoutes = [
  ['landing', '/'], ['room', '/room'], ['room-lobby', '/room?chat=l-0'], ['markets-avax', '/markets/AVAX'],
  ['markets-btc', '/markets/BTC'], ['crew', `/crew/${CREW}`], ['not-found', '/nope'],
];
const phoneRoutes = [
  ['chats', '/'], ['top', '/top'], ['market', '/market'], ['wallet', '/wallet'], ['chat-lobby', '/chat/l-0'],
  ['chat-crew', `/chat/c-${CREW}`], ['join', `/join/c-${CREW}`], ['invite', '/invite'], ['backup', '/backup'],
];

await withBrowser(async browser => {
  if (!process.env.SKIP_WEB) for (const [name, route] of webRoutes) {
    if (only && !only.has(name)) continue;
    for (const [w, h] of [[1440, 900], [375, 812]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', x => errors.push(String(x)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(WEB + route, { waitUntil: 'networkidle' }).catch(x => errors.push(String(x)));
      await page.waitForTimeout(6000);
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: join(OUT, `web-${name}-${w}.png`), fullPage: true });
      report(`web-${name}-${w}`, overflow, errors);
      await ctx.close();
    }
  }
  if (process.env.SKIP_PHONE) return;
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', x => errors.push(String(x)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="create-wallet"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, 'phone-onboarding.png') });
  report('phone-onboarding', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), errors);
  // A fresh wallet: the real gas-free start (one KumiGasStation drip and the test USDC faucet), then every screen.
  await page.locator('[data-testid="create-wallet"]').click();
  await page.locator('[data-testid="gas-free-start"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'phone-onboarding-funding.png') });
  await page.waitForFunction(() => document.querySelector('[data-testid="gas-free-start"]')?.querySelectorAll('[role="link"]').length >= 2, null, { timeout: 120_000 }).catch(x => errors.push(`gas start: ${x.message.split('\n')[0]}`));
  await page.screenshot({ path: join(OUT, 'phone-onboarding-ready.png') });
  await page.locator('[data-testid="finish-onboarding"]').click({ timeout: 120_000 }).catch(x => errors.push(`finish: ${x.message.split('\n')[0]}`));
  await page.getByText('Your chats').first().waitFor({ timeout: 60_000 }).catch(() => {});
  for (const [name, route] of phoneRoutes) {
    if (only && !only.has(`phone-${name}`)) continue;
    errors.length = 0;
    await page.goto(APP + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    const extra = await page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(d).overflowY)).reduce((m, d) => Math.max(m, d.scrollHeight - d.clientHeight), 0));
    await page.setViewportSize({ width: 375, height: Math.min(812 + extra, 5000) });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await page.screenshot({ path: join(OUT, `phone-${name}.png`) });
    report(`phone-${name}`, overflow, errors);
    await page.setViewportSize({ width: 375, height: 812 });
  }
  await ctx.close();
});
process.exit(failed ? 1 : 0);
