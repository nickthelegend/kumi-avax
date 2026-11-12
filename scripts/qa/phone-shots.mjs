/**
 * Read-only phone screenshots (no transactions): a fresh in-app wallet, then the given routes at 375 x 812.
 *   node qa/phone-shots.mjs http://127.0.0.1:5352 name=/route[#click-testid] ...
 * A route may end in #<testID> to tap that element first (for example /market#market-BTC).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withBrowser } from './harness.mjs';

const [base = 'http://127.0.0.1:5352', ...pairs] = process.argv.slice(2);
const OUT = process.env.SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/v2';
mkdirSync(OUT, { recursive: true });

await withBrowser(async browser => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', x => errors.push(String(x)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="create-wallet"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, 'phone-onboarding.png') });
  await page.locator('[data-testid="create-wallet"]').click();
  await page.locator('[data-testid="finish-onboarding"]').click();
  await page.getByText('Your chats').first().waitFor({ timeout: 60_000 });
  for (const [name, spec] of pairs.map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; })) {
    const [route, click] = spec.split('#');
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);
    if (click) { await page.locator(`[data-testid="${click}"]`).first().click(); await page.waitForTimeout(7000); }
    const extra = await page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(d).overflowY)).reduce((m, d) => Math.max(m, d.scrollHeight - d.clientHeight), 0));
    await page.setViewportSize({ width: 375, height: Math.min(812 + extra, 6000) });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `phone-${name}.png`) });
    console.log(`shot phone-${name}.png`);
    await page.setViewportSize({ width: 375, height: 812 });
  }
  console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
  await ctx.close();
});
