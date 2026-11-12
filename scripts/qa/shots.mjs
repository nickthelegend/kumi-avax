/**
 * Screenshots every route at 1440 and 375 into orchestration/shots/avax-kumi, with a QA signer so signed-in
 * states render. Fails when a route is empty, throws, logs a console error or scrolls sideways.
 *   node qa/shots.mjs http://127.0.0.1:5341 [name=route ...]
 */
import { mkdirSync } from 'node:fs';
import { withBrowser, qaPage } from './harness.mjs';

const [base = 'http://127.0.0.1:5341', ...pairs] = process.argv.slice(2);
const OUT = process.env.SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi';
mkdirSync(OUT, { recursive: true });
const routes = pairs.length ? pairs.map(p => p.split('=')) : [['landing', '/'], ['room', '/room'], ['room-fund', '/room#fund'], ['markets-avax', '/markets/AVAX'], ['markets-btc', '/markets/BTC'], ['crew', '/crew']];
let failed = false;
await withBrowser(async browser => {
  for (const [name, route] of routes) {
    for (const [w, h] of [[1440, 900], [375, 812]]) {
      const { page, ctx, errors } = await qaPage(browser, { width: w, height: h, as: process.env.QA_AS ?? 'mika' });
      await page.goto(base + route.replace('#fund', ''), { waitUntil: 'networkidle' }).catch(x => errors.push(String(x)));
      await page.waitForTimeout(Number(process.env.QA_WAIT_MS ?? 7000));
      if (route.endsWith('#fund') && w < 1000) await page.click('.tabs button:has-text("Fund")').catch(() => {});
      if (route.endsWith('#fund') && w < 1000) await page.waitForTimeout(800);
      const check = await page.evaluate(() => ({ text: (document.getElementById('root')?.innerText ?? '').trim().length, overflow: document.documentElement.scrollWidth - window.innerWidth }));
      const file = `${OUT}/${name}-${w}.png`;
      await page.screenshot({ path: file, fullPage: !route.startsWith('/room') });
      const ok = check.text > 0 && errors.length === 0 && check.overflow <= 0;
      if (!ok) failed = true;
      console.log(JSON.stringify({ name, w, ok, overflow: check.overflow, errors: errors.slice(0, 3) }));
      await ctx.close();
    }
  }
});
process.exit(failed ? 1 : 0);
