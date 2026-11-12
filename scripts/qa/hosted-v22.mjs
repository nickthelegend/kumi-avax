/**
 * v2.2 on the hosted apps (production builds, no QA signer, nothing injected):
 *  - kumi-avax-app.vercel.app at 375: a NEW wallet made in the page -> Kumi's gas sponsor drips 0.0002 AVAX
 *    (KumiGasStation on Fuji, via kumi-avax-api.vercel.app) -> 1,000 test USDC signed by that wallet -> Open Kumi
 *    -> Top tab -> join the AVAX pit -> a real Kumi AI answer in the chat.
 *  - kumi-avax-web.vercel.app at 1440 and 375: the AVAX pit with the Top callers panel and caller badges, read-only.
 * Fails on a console error or sideways scroll. Txs go under "hostedV22" in deployments/fuji.json.
 *   node qa/hosted-v22.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, withBrowser } from './harness.mjs';

const APP = process.env.APP ?? 'https://kumi-avax-app.vercel.app';
const WEB = process.env.WEB ?? 'https://kumi-avax-web.vercel.app';
const OUT = process.env.SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/v2.2';
let failed = false;
const check = async (name, page, errors) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const real = errors.filter(e => !/favicon|DevTools|expo-notifications|Download the React DevTools/.test(e));
  const ok = overflow <= 0 && real.length === 0;
  if (!ok) failed = true;
  console.log(JSON.stringify({ name, ok, overflow, errors: real.slice(0, 3) }));
};

await withBrowser(async browser => {
  // ---------------------------------------------------------------- phone app, hosted
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', x => errors.push(String(x)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const tid = id => page.locator(`[data-testid="${id}"]`).first();
    await page.goto(APP, { waitUntil: 'networkidle' });
    await tid('create-wallet').waitFor({ timeout: 60_000 });
    await tid('create-wallet').click();
    await tid('gas-free-start').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, 'hosted-phone-gas-start.png') });
    // both rows done: two Snowtrace links inside the start card
    await page.waitForFunction(() => {
      const box = document.querySelector('[data-testid="gas-free-start"]');
      return box && box.querySelectorAll('[role="link"]').length >= 2;
    }, null, { timeout: 120_000 }).catch(async e => {
      const t = await tid('gas-free-start').innerText().catch(() => '');
      throw Error(`gas-free start did not finish: ${t.replace(/\s+/g, ' ')} (${e.message.split('\n')[0]})`);
    });
    const address = await page.evaluate(() => [...document.querySelectorAll('div')].map(d => d.textContent ?? '').find(t => /^0x[0-9a-fA-F]{40}$/.test(t.trim()))?.trim());
    const activity = await page.evaluate(() => JSON.parse(localStorage.getItem('kumi.activity.v1') ?? '[]'));
    console.log(`hosted phone wallet ${address}: ${activity.map(a => `${a.label} ${a.hash}`).join(' | ')}`);
    await page.screenshot({ path: join(OUT, 'hosted-phone-gas-ready.png') });
    await check('hosted-phone-onboarding', page, errors);

    await tid('finish-onboarding').click();
    await tid('tab-top').waitFor({ timeout: 30_000 });
    await tid('tab-top').click();
    await tid('caller-1').waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, 'hosted-phone-top.png') });
    await check('hosted-phone-top', page, errors);

    await page.goto(`${APP}/chat/l-0`, { waitUntil: 'networkidle' });
    await tid('join-chat').waitFor({ timeout: 60_000 });
    await tid('join-chat').click();
    await tid('ask-ai').waitFor({ timeout: 90_000 });
    await tid('ask-ai').click();
    await tid('composer').fill('/ask who are the best callers here, and how is the AVAX book?');
    await tid('send').click();
    await tid('ai-tools').waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    const answer = await page.locator('[data-testid="ai-tools"]').first().locator('xpath=..').innerText();
    console.log(`hosted Kumi AI: ${answer.replace(/\s+/g, ' ').slice(0, 280)}`);
    await page.screenshot({ path: join(OUT, 'hosted-phone-ai.png') });
    await check('hosted-phone-ai', page, errors);
    const all = await page.evaluate(() => JSON.parse(localStorage.getItem('kumi.activity.v1') ?? '[]'));
    const d = JSON.parse(readFileSync(join(ROOT, 'deployments/fuji.json'), 'utf8'));
    (d.hostedV22 ??= []).push({ at: new Date().toISOString(), app: APP, wallet: address, txs: all.reverse() });
    writeFileSync(join(ROOT, 'deployments/fuji.json'), JSON.stringify(d, null, 2) + '\n');
    await ctx.close();
  }
  // ---------------------------------------------------------------- web app, hosted, read-only
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', x => errors.push(String(x)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${WEB}/room?chat=l-0`, { waitUntil: 'networkidle' });
    if (w < 1000) { await page.waitForSelector('.caller-badge', { timeout: 90_000 }); await page.waitForTimeout(1200); await page.screenshot({ path: join(OUT, `hosted-web-lobby-${w}.png`) }); await page.locator('.tabs button', { hasText: 'Info' }).click(); }
    await page.waitForSelector('.tc-row', { timeout: 90_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `hosted-web-top-callers-${w}.png`) });
    await check(`hosted-web-${w}`, page, errors);
    await ctx.close();
  }
});
process.exit(failed ? 1 : 0);
