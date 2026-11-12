/**
 * The live Fuji demo, driven through the web app (QA build) with the three QA signers:
 *   chip in (mika, bo, ren) -> chat -> mika pitches /long AVAX 3x -> bo votes, the vault opens on the book ->
 *   the price moves (the maker leans its quotes, or Chainlink moves) -> ren pitches /close AVAX, mika votes,
 *   the vault closes with PnL -> ren ragequits.
 * Every transaction the app sends is captured from its `kumi:tx` event and appended to deployments/fuji.json
 * under "demo", with a screenshot per step in docs/screenshots/demo-*.png.
 *   node qa/demo.mjs http://127.0.0.1:5341 [--from step]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { withBrowser, qaPage, ROOT } from './harness.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5341';
const from = Number(process.argv[process.argv.indexOf('--from') + 1] || 1);
const SHOTS = join(ROOT, 'docs/screenshots');
mkdirSync(SHOTS, { recursive: true });
const DEP = join(ROOT, 'deployments/fuji.json');
const log = (step, tx) => {
  const d = JSON.parse(readFileSync(DEP, 'utf8'));
  (d.demo ??= []).push({ step, ...tx, at: new Date().toISOString() });
  writeFileSync(DEP, JSON.stringify(d, null, 2) + '\n');
  console.log(`  ${step}: ${tx.functionName} ${tx.hash}`);
};

await withBrowser(async browser => {
  const { page, errors, txs } = await qaPage(browser, { width: 1440, height: 900, as: 'mika' });
  let seen = 0;
  async function waitTxs(n, step, timeout = 90_000) {
    const t0 = Date.now();
    while (txs.length < seen + n) {
      const err = await page.locator('.notice-error').last().textContent({ timeout: 200 }).catch(() => null);
      if (err && Date.now() - t0 > 3000) throw Error(`${step}: the app showed an error: ${err}`);
      if (Date.now() - t0 > timeout) throw Error(`${step}: timed out waiting for ${n} tx`);
      await page.waitForTimeout(300);
    }
    for (const t of txs.slice(seen, seen + n)) log(step, t);
    seen += n;
    await page.waitForTimeout(4500); // one refresh of the room
  }
  const as = async who => { await page.selectOption('select[aria-label="QA signer"]', who); await page.waitForTimeout(4500); };
  const shot = async name => page.screenshot({ path: join(SHOTS, `demo-${name}.png`) });
  const say = async text => { await page.fill('input[aria-label="Message"]', text); await page.click('button[aria-label="Send"]'); };
  const chipIn = async (who, amount) => {
    await as(who);
    await page.click('.stake-actions .btn-butter');
    await page.fill('.sheet input', String(amount));
    const needApprove = true;
    await page.click('.sheet .btn-primary');
    await waitTxs(needApprove ? 2 : 1, `1-chip-in-${who}`);
    await page.click('.sheet .btn-ghost');
  };

  await page.goto(`${base}/room`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);

  if (from <= 1) {
    await chipIn('mika', 400);
    await chipIn('bo', 350);
    await chipIn('ren', 250);
    await shot('1-chipped-in');
  }
  if (from <= 2) {
    await as('mika');
    await say('gm crew. AVAX has held $8.5 all week, I want in');
    await waitTxs(1, '2-chat');
    await say('/long AVAX 3x');
    await waitTxs(1, '2-pitch-long-avax-3x');
    await shot('2-pitched');
  }
  if (from <= 3) {
    await as('bo');
    await page.locator('article.trade[data-status="voting"] button:has-text("Vote yes")').last().click();
    await waitTxs(1, '3-vote-bo-yes-opens');
    await shot('3-opened');
  }
  if (from <= 4) {
    // Price move: the maker leans its quotes up 0.6% (its own real orders on the book); Chainlink keeps updating too.
    execFileSync('node', ['fuji/maker.ts', '--skew-bps', process.env.DEMO_SKEW_BPS ?? '60', '--market', 'AVAX'], { cwd: join(ROOT, 'scripts'), stdio: 'inherit' });
    await page.waitForTimeout(6000);
    await shot('4-price-moved');
  }
  if (from <= 5) {
    await as('ren');
    await say('/close AVAX');
    await waitTxs(1, '5-pitch-close-avax');
    await as('mika');
    await page.locator('article.trade[data-status="voting"] button:has-text("Vote yes")').last().click();
    await waitTxs(1, '5-vote-mika-yes-closes');
    await say('locked it in. drinks on the fund');
    await waitTxs(1, '5-chat');
    await shot('5-closed-pnl');
  }
  if (from <= 6) {
    await as('ren');
    await page.click('.stake-actions .btn-pink');
    await page.click('.sheet .seg button:has-text("Everything")');
    await page.click('.sheet .btn-pink');
    await waitTxs(1, '6-ragequit-ren');
    await shot('6-ragequit');
    await page.click('.sheet .btn-ghost');
  }
  if (errors.length) console.log('console errors:', errors.slice(0, 5));
});
// Put the maker back on the oracle.
execFileSync('node', ['fuji/maker.ts', '--market', 'AVAX'], { cwd: join(ROOT, 'scripts'), stdio: 'inherit' });
