/**
 * The private balance in the web app, end to end on Fuji, with the QA signer (VITE_QA build, keys injected by the
 * harness, never printed): bo opens his eERC key in Night Owls and reads the settle-up he sent mika, then settles
 * up privately with ren (transfer proof made in the page); ren opens the AVAX pit and tips mika privately for the
 * call he copied. Txs go under "webPrivate" in deployments/fuji.json; screenshots to shots/avax-kumi/v2.1.
 *   node qa/serve.mjs ../../web/dist-qa 5353 &  node qa/web-private.mjs http://127.0.0.1:5353
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOYMENT } from '@kumi-avax/sdk';
import { ROOT, qaPage, withBrowser } from './harness.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5353';
const OUT = '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/v2.1';
const owls = DEPLOYMENT.crews.find(c => c.name === 'Night Owls').address;
const all = [];

await withBrowser(async browser => {
  const run = async (as, fn) => {
    const { page, ctx, errors, txs } = await qaPage(browser, { width: 1440, height: 900, as });
    try { await fn(page); } finally {
      all.push(...txs.map(t => ({ as, ...t })));
      const real = errors.filter(e => !/favicon|DevTools/.test(e));
      console.log(`${as}: ${txs.length} txs, ${real.length ? `console errors: ${real.join(' | ')}` : 'no console errors'}`);
      await ctx.close();
    }
  };
  const sent = async (page, name) => {
    const err = page.getByRole('dialog').locator('.notice-error').first();
    await Promise.race([
      page.getByText('Sent privately.').waitFor({ timeout: 240_000 }),
      err.waitFor({ timeout: 240_000 }).then(async () => { await shot(page, `web-error-${name}`); throw Error(`${name}: ${await err.textContent()}`); }),
    ]);
  };
  const shot = async (page, name) => { await page.waitForTimeout(1000); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log(`shot ${name}.png`); };

  await run('bo', async page => {
    await page.goto(`${BASE}/room?crew=${owls}`, { waitUntil: 'networkidle' });
    await page.getByText('Settle up privately').first().waitFor({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Decrypt with my key' }).click();
    await page.getByText('Decrypted in this browser').waitFor({ timeout: 60_000 });
    await page.locator('.pcard').first().scrollIntoViewIfNeeded();
    await page.locator('.pcard b.mono').first().waitFor({ timeout: 60_000 });
    await shot(page, 'web-crew-private-1440');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /mika/ }).click();
    await page.getByRole('dialog').locator('input').fill('2.00');
    await page.waitForTimeout(1500);
    await shot(page, 'web-crew-send-sheet-1440');
    const t0 = Date.now();
    await page.getByRole('dialog').getByRole('button', { name: /Send 2\.00 privately/ }).click();
    await sent(page, 'crew-send');
    console.log(`bo -> mika 2.00 privately in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.getByRole('button', { name: 'Back to the chat' }).click();
    await page.waitForTimeout(8000);
    await shot(page, 'web-crew-after-send-1440');
  });

  await run('ren', async page => {
    await page.goto(`${BASE}/room?chat=l-0`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Tip privately' }).first().waitFor({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Tip privately' }).first().click();
    await page.getByRole('dialog').locator('input').fill('0.75');
    await page.getByRole('dialog').getByText(/private$/).waitFor({ timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, 'web-lobby-tip-sheet-1440');
    const t0 = Date.now();
    await page.getByRole('dialog').getByRole('button', { name: /Tip 0\.75 privately/ }).click();
    await sent(page, 'lobby-tip');
    console.log(`ren tipped mika 0.75 privately in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.getByRole('button', { name: 'Back to the chat' }).click();
    await page.waitForTimeout(8000);
    await shot(page, 'web-lobby-after-tip-1440');
  });
});

const f = join(ROOT, 'deployments/fuji.json');
const d = JSON.parse(readFileSync(f, 'utf8'));
(d.webPrivate ??= []).push({ at: new Date().toISOString(), txs: all });
writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
console.log(`${all.length} txs recorded under webPrivate`);
