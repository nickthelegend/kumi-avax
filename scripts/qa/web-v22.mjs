/**
 * v2.2 in the web app (QA build, QA signer injected by the harness, keys never printed): the AVAX pit with caller
 * badges and the Top callers panel, a real Kumi AI answer (claude-haiku-5-5 on Kumi's API, pass signed by the QA
 * signer), and Kumi AI in the Night Owls crew room. Screenshots at 1440 and 375 into shots/avax-kumi/v2.2.
 * Fails on a console error or sideways scroll.
 *   node qa/serve.mjs ../../web/dist-qa 5353 &  node qa/web-v22.mjs http://127.0.0.1:5353
 */
import { DEPLOYMENT } from '@kumi-avax/sdk';
import { qaPage, withBrowser } from './harness.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5353';
const OUT = process.env.SHOTS ?? '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-kumi/v2.2';
const owls = DEPLOYMENT.crews.find(c => c.name === 'Night Owls').address;
let failed = false;

async function ask(page, q) {
  await page.locator('.ai-spark').first().click();
  await page.locator('.composer-box input').fill(`/ask ${q}`);
  await page.locator('.composer-box').evaluate(f => f.requestSubmit());
  await page.waitForSelector('.ai-card[aria-busy="true"]', { timeout: 10_000 });
  await page.waitForFunction(() => !document.querySelector('.ai-card[aria-busy="true"]'), null, { timeout: 90_000 });
  const err = await page.locator('.composer .notice-error, .composer [role="alert"]').first().textContent({ timeout: 500 }).catch(() => null);
  if (err) throw Error(`Kumi AI error: ${err}`);
  return page.locator('.ai-card').last().innerText();
}

const report = async (name, page, errors) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const real = errors.filter(e => !/favicon|DevTools/.test(e));
  const ok = overflow <= 0 && real.length === 0;
  if (!ok) failed = true;
  console.log(JSON.stringify({ name, ok, overflow, errors: real.slice(0, 3) }));
};

await withBrowser(async browser => {
  // 1. AVAX pit at 1440: badges, Top callers, then a real Kumi AI answer
  {
    const { page, ctx, errors } = await qaPage(browser, { width: 1440, height: 900, as: 'mika' });
    await page.goto(`${BASE}/room?chat=l-${DEPLOYMENT.lobbyChannels.avaxpit}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tc-row', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/web-lobby-top-callers-1440.png` });
    await report('web-lobby-top-callers-1440', page, errors);
    const text = await ask(page, 'how tight is the AVAX book, and who should I watch in this chat?');
    console.log(`AI: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/web-ai-answer-1440.png` });
    await page.locator('.seg-mini button', { hasText: 'All chats' }).click();
    await page.waitForTimeout(600);
    await page.locator('.top-callers').screenshot({ path: `${OUT}/web-top-callers-all-1440.png` });
    await report('web-ai-answer-1440', page, errors);
    await ctx.close();
  }
  // 2. AVAX pit at 375: the chat with badges, then the Info tab with Top callers
  {
    const { page, ctx, errors } = await qaPage(browser, { width: 375, height: 812, as: 'mika' });
    await page.goto(`${BASE}/room?chat=l-${DEPLOYMENT.lobbyChannels.avaxpit}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.caller-badge', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/web-lobby-badges-375.png` });
    await report('web-lobby-badges-375', page, errors);
    const text = await ask(page, 'what is my position doing?');
    console.log(`AI 375: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/web-ai-answer-375.png` });
    await page.locator('.tabs button', { hasText: 'Info' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/web-top-callers-375.png` });
    await report('web-top-callers-375', page, errors);
    await ctx.close();
  }
  // 3. Night Owls crew room at 1440: Kumi AI drafts a pitch, which fills the composer (not sent)
  {
    const { page, ctx, errors } = await qaPage(browser, { width: 1440, height: 900, as: 'mika' });
    await page.goto(`${BASE}/room?crew=${owls}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.composer-box input', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const text = await ask(page, 'draft a small BTC long pitch for the crew, 2x');
    console.log(`AI crew: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    const pitch = page.locator('.ai-card').last().getByRole('button', { name: 'Pitch it' });
    if (await pitch.count()) { await pitch.click(); await page.waitForTimeout(500); console.log(`composer: ${await page.locator('.composer-box input').inputValue()}`); }
    await page.screenshot({ path: `${OUT}/web-crew-ai-pitch-1440.png` });
    await report('web-crew-ai-pitch-1440', page, errors);
    await ctx.close();
  }
});
process.exit(failed ? 1 : 0);
