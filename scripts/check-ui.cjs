// Opens each bundled tool (under the same sandbox rules an Omniscio Share uses) and the hub,
// at phone and desktop size, and fails on sideways scrolling, console errors or dead output.
// Needs Playwright on NODE_PATH and a local Chrome; see README "Getting started".
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHARE_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
const VIEWPORTS = [{ width: 390, height: 844, isMobile: true }, { width: 1280, height: 800, isMobile: false }];
const CHALLENGE_DAYS = 10;
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const COPIED = 'Copied ✓';
const SCREENSHOT_MS = 120000; // A busy machine can take over the default 30 seconds.

function serve() {
  return http.createServer((req, res) => {
    const tool = req.url.match(/^\/tool\/([a-z0-9-]+)$/);
    if (tool) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': SHARE_CSP });
      return res.end(fs.readFileSync(path.join(ROOT, 'dist', `${tool[1]}.html`)));
    }
    const rel = req.url.replace(/^\/hub\/?/, '') || 'index.html';
    const file = path.join(ROOT, 'docs', path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

async function openPage(browser, url, vp) {
  const context = await browser.newContext({ viewport: vp, isMobile: vp.isMobile, hasTouch: vp.isMobile });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page, errors };
}

// Measured against the viewport we asked for: a phone zooms out to fit wide content, so innerWidth grows with it.
const sidewaysScroll = (page) => page.evaluate((width) => document.documentElement.scrollWidth - width, page.viewportSize().width);

async function checkRoas(page) {
  const before = await page.textContent('#out-roas');
  await page.fill('#productCost', '25');
  const after = await page.textContent('#out-roas');
  await page.fill('#productCost', '60');
  const loss = await page.textContent('#out-verdict');
  if (before === after) return 'ROAS did not update when an input changed';
  if (!/lose money/.test(loss)) return 'loss message did not appear for a losing order';
  return null;
}

// --- UTM: the three ways Copy can go, forced one at a time by replacing the browser's own APIs ---

const stubClipboard = (page, works) => page.evaluate((ok) => {
  window.__copied = null;
  const writeText = ok ? async (t) => { window.__copied = t; } : async () => { throw new Error('blocked'); };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}, works);

const stubCopyCommand = (page, works) => page.evaluate((ok) => {
  document.execCommand = (cmd) => {
    if (!ok || cmd !== 'copy') return false;
    window.__copied = document.activeElement && document.activeElement.value;
    return true;
  };
}, works);

async function checkCopyPaths(page) {
  const link = await page.textContent('#link');
  await stubClipboard(page, true);
  await page.click('#copy');
  if (await page.evaluate(() => window.__copied) !== link) return 'Clipboard API path did not copy the link';
  if (await page.textContent('#copy') !== COPIED) return 'Copy button did not confirm';
  await stubClipboard(page, false);
  await stubCopyCommand(page, true);
  await page.click('#copy');
  if (await page.evaluate(() => window.__copied) !== link) return 'copy-command fallback did not copy the link';
  await stubCopyCommand(page, false);
  await page.click('#copy');
  const manual = await page.evaluate(() => {
    const box = document.getElementById('copy-manual');
    return { shown: !box.hidden, value: box.value, focused: document.activeElement === box,
      selected: box.selectionStart === 0 && box.selectionEnd === box.value.length };
  });
  const told = /press (Ctrl|⌘)\+?C/i.test(await page.textContent('#copy-status'));
  if (!manual.shown || manual.value !== link || !manual.focused || !manual.selected || !told) {
    return `manual fallback did not select the link and say press Ctrl+C: ${JSON.stringify(manual)}`;
  }
  return null;
}

async function checkUtmSingle(page) {
  if (!/utm_source=Newsletter/.test(await page.textContent('#link'))) return 'example link did not render';
  if (!/to fix/i.test(await page.textContent('#chip'))) return 'example mistakes were not flagged';
  await page.click('#fix-all');
  const fixed = await page.textContent('#link');
  if (!/utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale/.test(fixed)) return `Fix all left: ${fixed}`;
  if (await page.textContent('#chip') !== 'Ready' || await page.isHidden('#clear')) return 'fixed link not shown as clean';
  await page.fill('#medium', 'facebook');
  if (!/Unassigned/.test(await page.textContent('#channel'))) return 'unknown medium not shown as Unassigned';
  await page.click('#issues .btn');
  if (await page.inputValue('#medium') !== 'social') return 'one-click medium fix did not apply';
  return null;
}

async function checkUtmBulk(page) {
  await page.click('#tab-bulk');
  if (await page.isHidden('#bulk') || await page.isVisible('#single')) return 'Bulk tab did not switch modes';
  if (await page.locator('#rows li').count() !== 4) return 'bulk did not list one row per data line';
  await page.click('#bulk-fix');
  if (!/https:\/\/example\.com\/boots,facebook,social,spring-sale/.test(await page.inputValue('#bulk-input'))) {
    return 'bulk Fix all did not rewrite the rows';
  }
  await stubClipboard(page, true);
  await page.keyboard.press('Control+Enter');
  const copied = await page.evaluate(() => window.__copied) || '';
  const lines = copied.split('\n');
  if (lines.length !== 4 || lines[3] !== '') return `Copy all (Ctrl+Enter) gave: ${copied}`;
  await page.fill('#bulk-input', '');
  await stubClipboard(page, true);
  await page.keyboard.press('Control+Enter');
  if (await page.evaluate(() => window.__copied) !== null) return 'Ctrl+Enter copied an empty bulk list over the clipboard';
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `bulk view scrolls sideways by ${scroll}px` : null;
}

// The real browser APIs under the Share's sandbox: either path is fine, silence is not.
async function checkRealCopy(page) {
  await page.click('#copy');
  await page.waitForTimeout(300);
  const copied = await page.textContent('#copy') === COPIED;
  const manual = await page.isVisible('#copy-manual');
  return copied || manual ? null : 'Copy did nothing with the real browser APIs';
}

async function checkUtm(page) {
  return await checkRealCopy(page) || await checkUtmSingle(page) || await checkCopyPaths(page) || await checkUtmBulk(page);
}

async function checkHub(page) {
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'tools.json'), 'utf8')).length;
  const shipped = await page.locator('.slot.shipped').count();
  const slots = await page.locator('.slot').count();
  if (slots !== CHALLENGE_DAYS) return `hub shows ${slots} day slots, expected ${CHALLENGE_DAYS}`;
  return shipped === expected ? null : `hub shows ${shipped} shipped cards, tools.json has ${expected}`;
}

// --- SERP: the example title is cut on desktop only; edits re-measure; ad counters turn coral ---

async function checkSerpOrganic(page) {
  if (!(await page.textContent('#desk .g-title')).endsWith(' ...')) return 'example title was not cut on desktop';
  if ((await page.textContent('#mobile .g-title')).endsWith(' ...')) return 'example title was cut on mobile too';
  if (await page.getAttribute('.meter', 'data-state') !== 'cut') return 'desktop title meter is not coral';
  if (!/Title cut on desktop/.test(await page.textContent('#warnings'))) return 'title cut warning missing';
  await page.fill('#title', 'Rain jackets');
  if (await page.textContent('#desk .g-title') !== 'Rain jackets') return 'short title did not show whole';
  if (await page.getAttribute('.meter', 'data-state') !== 'ok') return 'short title meter is not lime';
  await page.fill('#keyword', 'parka');
  return /“parka” isn’t in the title/.test(await page.textContent('#warnings')) ? null : 'missing keyword not flagged';
}

async function checkSerpAd(page) {
  await page.click('#tab-ad');
  if (await page.isHidden('#ad') || await page.isVisible('#organic')) return 'Search ad tab did not switch modes';
  if (!/Sponsored/.test(await page.textContent('#mobile'))) return 'ad preview is not marked Sponsored';
  await page.fill('#headline1', 'x'.repeat(31));
  const over = await page.getAttribute('#count-headline1', 'data-over');
  if (over !== 'true' || await page.textContent('#count-headline1') !== '31/30') return 'headline counter did not flag 31/30';
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `ad view scrolls sideways by ${scroll}px` : null;
}

async function checkSerp(page) {
  return await checkSerpOrganic(page) || await checkSerpAd(page);
}

// --- RSA: the example's mistakes are flagged; counters, pins and Shuffle drive the preview ---

async function checkRsaExample(page) {
  if (await page.textContent('#count') !== '252') return `example combination count is ${await page.textContent('#count')}, expected 252`;
  if (!/7 to fix/.test(await page.textContent('#chip'))) return `example chip says ${await page.textContent('#chip')}`;
  if (await page.getAttribute('#count-headline8', 'data-over') !== 'true') return '35-character headline counter is not coral';
  if (!/Sponsored/.test(await page.textContent('#mobile'))) return 'ad preview is not marked Sponsored';
  return (await page.textContent('#desk .g-title')).startsWith('Waterproof Rain Jackets') ? null : 'pinned headline 1 is not first';
}

async function checkRsaShuffle(page) {
  const before = await page.textContent('#desk .g-title') + await page.textContent('#desk .g-desc');
  await page.click('#shuffle');
  const after = await page.textContent('#desk .g-title') + await page.textContent('#desk .g-desc');
  if (before === after) return 'Shuffle did not draw a different ad';
  return (await page.textContent('#mobile .g-title')).startsWith('Waterproof Rain Jackets') ? null : 'Shuffle broke the pin';
}

async function checkRsaEdits(page) {
  await page.selectOption('#pin-headline1', '0');
  if (await page.textContent('#count') !== '2,016') return 'unpinning did not raise the count to 2,016';
  await page.fill('#headline5', 'Shop Our New Arrivals');
  if (/“!” in/.test(await page.textContent('#warnings'))) return 'headline ! warning did not clear';
  await page.fill('#headline1', 'x'.repeat(31));
  if (await page.textContent('#count-headline1') !== '31/30') return 'headline counter did not show 31/30';
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `edited view scrolls sideways by ${scroll}px` : null;
}

async function checkRsa(page) {
  return await checkRsaExample(page) || await checkRsaShuffle(page) || await checkRsaEdits(page);
}

// --- Feed: the example's mistakes, the three ways Copy can go, files under the Share's sandbox, a huge paste ---

const FEED_HEADER = 'id,title,description,link,image_link,availability,price,brand,gtin';
const feedRow = (i, price) => `A${i},Rain jacket ${i},Dry.,https://e.com/${i},https://e.com/${i}.jpg,in_stock,${price},Northline,012345678905`;
const HUGE_ROWS = 50000;
const HUGE_MAX_MS = 20000;
const RENDERED_ROWS = 300;

const headlineIs = (page, text) => page.waitForFunction((t) => document.getElementById('headline').textContent === t, text, { timeout: HUGE_MAX_MS });

async function checkFeedExample(page) {
  if (await page.textContent('#headline') !== '5 of 9 products need fixing') return `example headline: ${await page.textContent('#headline')}`;
  if (await page.textContent('#split') !== '4 would be rejected · 1 weakened') return `example split: ${await page.textContent('#split')}`;
  if (await page.locator('#table-body tr').count() !== 9) return 'table did not list all 9 products';
  if (await page.locator('#table-body td[data-severity="error"]').count() !== 4) return 'expected 4 coral cells';
  if (await page.locator('#table-body td[data-severity="warning"]').count() !== 1) return 'expected 1 amber cell';
  if (!/15\.00 USD/.test(await page.textContent('#table-body'))) return 'row reasons missing from the table';
  await page.check('#only-problems');
  if (await page.locator('#table-body tr').count() !== 5) return 'Show only problems did not hide clean rows';
  await page.uncheck('#only-problems');
  return await page.locator('#table-body tr').count() === 9 ? null : 'Show only problems did not switch back';
}

// Copy problem list (feed, listing): the real APIs, then each fallback forced in turn, all copying the same list.
async function checkProblemListCopy(page, expected) {
  await page.click('#copy');
  await page.waitForTimeout(300);
  if (await page.textContent('#copy') !== COPIED && !await page.isVisible('#copy-manual')) return 'Copy did nothing with the real browser APIs';
  await stubClipboard(page, true);
  await page.click('#copy');
  const first = await page.evaluate(() => window.__copied);
  if (!expected.test(first || '')) return `Clipboard API path copied: ${first}`;
  await stubClipboard(page, false);
  await stubCopyCommand(page, true);
  await page.click('#copy');
  if (await page.evaluate(() => window.__copied) !== first) return 'copy-command fallback did not copy the list';
  await stubCopyCommand(page, false);
  await page.click('#copy');
  const manual = await page.evaluate(() => {
    const box = document.getElementById('copy-manual');
    return { shown: !box.hidden, value: box.value, selected: box.selectionStart === 0 && box.selectionEnd === box.value.length };
  });
  const told = /press (Ctrl|⌘)\+?C/i.test(await page.textContent('#copy-status'));
  return manual.shown && manual.value === first && manual.selected && told ? null : 'manual fallback did not select the list';
}

async function checkFeedFiles(page) {
  await page.setInputFiles('#file', { name: 'picked.csv', mimeType: 'text/csv', buffer: Buffer.from(`${FEED_HEADER}\n${feedRow(1, '59.00 USD')}`) });
  await headlineIs(page, 'Your 1 product looks clean');
  if (!/Read picked\.csv/.test(await page.textContent('#file-status'))) return 'file pick did not confirm';
  await page.setInputFiles('#file', { name: 'catalog.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK') });
  if (!/Save it as CSV/.test(await page.textContent('#file-status'))) return 'wrong file type was not refused';
  // A real OS drag can't be driven from here; this is the same drop event carrying a real File.
  await page.evaluate(([name, text]) => {
    const data = new DataTransfer();
    data.items.add(new File([text], name, { type: 'text/tab-separated-values' }));
    for (const type of ['dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, ['dropped.tsv', `${FEED_HEADER.replace(/,/g, '\t')}\n${feedRow(1, '$59').replace(/,/g, '\t')}`]);
  await headlineIs(page, '1 of 1 product needs fixing');
  return /Read dropped\.tsv/.test(await page.textContent('#file-status')) ? null : 'drag and drop did not confirm';
}

async function checkFeedHuge(page) {
  const rows = [];
  for (let i = 0; i < HUGE_ROWS; i++) rows.push(feedRow(i, i % 2 ? '59.00 USD' : '$59'));
  const text = `${FEED_HEADER}\n${rows.join('\n')}`;
  const start = Date.now();
  await page.evaluate((feed) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', feed);
    document.getElementById('feed').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  await headlineIs(page, '25,000 of 50,000 products need fixing');
  const took = Date.now() - start;
  console.log(`  feed: ${HUGE_ROWS} rows pasted, checked and drawn in ${took}ms`);
  if (took > HUGE_MAX_MS) return `50,000 rows took ${took}ms`;
  if ((await page.inputValue('#feed')).length >= text.length / 10) return 'huge feed went into the text box';
  if (!/every row is checked/.test(await page.textContent('#file-status'))) return 'huge feed did not explain the short text box';
  if (await page.locator('#table-body tr').count() !== RENDERED_ROWS) return 'huge feed did not cap the table';
  if (!/first 300 of 50,000/.test(await page.textContent('#cap'))) return 'huge feed did not say it capped the table';
  await page.check('#only-problems');
  if (!/first 300 of 25,000/.test(await page.textContent('#cap'))) return 'cap did not follow Show only problems';
  await page.fill('#feed', `${FEED_HEADER}\n${feedRow(1, '59.00 USD')}`);
  await headlineIs(page, 'Your 1 product looks clean');
  await page.setInputFiles('#file', { name: 'huge.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await headlineIs(page, '25,000 of 50,000 products need fixing');
  return (await page.inputValue('#feed')).length < text.length / 10 ? null : 'huge file went into the text box';
}

async function checkFeedBox(page) {
  const box = await page.evaluate(() => {
    const b = document.getElementById('table-box');
    return { wider: b.scrollWidth > b.clientWidth, overflow: getComputedStyle(b).overflowX };
  });
  if (!box.wider || box.overflow !== 'auto') return `table does not scroll inside its box: ${JSON.stringify(box)}`;
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `feed page scrolls sideways by ${scroll}px` : null;
}

async function checkFeedStates(page) {
  await page.fill('#feed', 'just,some,words\nand,more,words');
  await headlineIs(page, 'Nothing to check yet');
  if (!/No header row/.test(await page.textContent('#notice'))) return 'missing header was not explained';
  if (await page.isVisible('#results')) return 'table showed with no products';
  return await page.isDisabled('#copy') ? null : 'Copy stayed live with nothing to copy';
}

async function checkFeed(page) {
  return await checkFeedExample(page) || await checkFeedBox(page)
    || await checkProblemListCopy(page, /^5 of 9 products need fixing\n\nRow 4 \(RJ-102\): /)
    || await checkFeedFiles(page) || await checkFeedHuge(page) || await checkFeedStates(page);
}

// --- Listing: the example's blockers, live counters, bytes not characters, the title limit, highlights, copy ---

async function checkListingExample(page) {
  if (await page.textContent('#headline') !== '5 problems would block this listing') return `example headline: ${await page.textContent('#headline')}`;
  if (await page.locator('#checks .check[data-level="reject"]').count() !== 5) return 'expected 5 coral checks';
  if (await page.locator('#checks .check[data-level="weak"]').count() !== 5) return 'expected 5 amber checks';
  const marks = await page.locator('#context mark').allTextContents();
  for (const phrase of ['antimicrobial', 'money-back guarantee', 'www.northlinegear.com', '!']) {
    if (!marks.includes(phrase)) return `“${phrase}” is not highlighted in context: ${JSON.stringify(marks)}`;
  }
  return /^\d+\/249 bytes · \d+ characters$/.test(await page.textContent('#count-searchTerms')) ? null : 'search terms counter does not show bytes and characters';
}

async function checkListingEdits(page) {
  await page.fill('#searchTerms', 'é'.repeat(125));
  if (await page.textContent('#count-searchTerms') !== '250/249 bytes · 125 characters') return `byte counter: ${await page.textContent('#count-searchTerms')}`;
  if (await page.getAttribute('#count-searchTerms', 'data-over') !== 'true') return 'search terms counter is not coral at 250 bytes';
  await page.selectOption('#title-limit', '80');
  if (await page.getAttribute('#count-title', 'data-over') !== 'true') return 'title counter is not coral under an 80-character limit';
  if (!/The limit is 80/.test(await page.textContent('#checks'))) return 'switching the title limit did not re-check the title';
  await page.selectOption('#title-limit', '200');
  await page.fill('#bullet3', 'Stays fresh: kills 99.9% of germs.');
  if (!(await page.locator('#context mark').allTextContents()).includes('kills 99.9% of germs')) return 'a new claim was not highlighted';
  return null;
}

async function checkListingClean(page) {
  const clean = { title: 'Northline Women’s Waterproof Rain Jacket with Hood, Black, Medium', description: 'A packable rain shell.', searchTerms: 'raincoat anorak' };
  for (const [id, value] of Object.entries(clean)) await page.fill(`#${id}`, value);
  for (let n = 1; n <= 5; n++) await page.fill(`#bullet${n}`, '');
  if (await page.textContent('#headline') !== 'Ready to publish') return `clean listing headline: ${await page.textContent('#headline')}`;
  if (await page.isHidden('#clear') || !await page.isDisabled('#copy')) return 'clean listing did not show all clear with Copy off';
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `edited listing scrolls sideways by ${scroll}px` : null;
}

async function checkListing(page) {
  return await checkListingExample(page)
    || await checkProblemListCopy(page, /^5 problems would block this listing\n\nTitle \(blocks\): /)
    || await checkListingEdits(page) || await checkListingClean(page);
}

const TOOL_CHECKS = { roas: checkRoas, utm: checkUtm, serp: checkSerp, rsa: checkRsa, feed: checkFeed, listing: checkListing };

(async () => {
  const server = serve().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  // Without a GPU process, screenshots keep working when the machine is short of memory.
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] });
  const failures = [];
  fs.mkdirSync(path.join(ROOT, 'dist', 'screens'), { recursive: true });
  const targets = Object.entries(TOOL_CHECKS).map(([tool, check]) => [tool, `${base}/tool/${tool}`, check]);
  for (const [name, url, check] of [...targets, ['hub', `${base}/hub/`, checkHub]]) {
    for (const vp of VIEWPORTS) {
      const { context, page, errors } = await openPage(browser, url, vp);
      const overflow = await sidewaysScroll(page);
      await page.screenshot({ path: path.join(ROOT, 'dist', 'screens', `${name}-${vp.width}.png`), fullPage: true, timeout: SCREENSHOT_MS })
        .catch((e) => failures.push(`${name} @${vp.width}px screenshot: ${e.message.split('\n')[0]}`));
      const problem = await check(page);
      if (overflow > 0) failures.push(`${name} @${vp.width}px scrolls sideways by ${overflow}px`);
      if (errors.length) failures.push(`${name} @${vp.width}px console errors: ${errors.join(' | ')}`);
      if (problem) failures.push(`${name} @${vp.width}px: ${problem}`);
      await context.close();
    }
  }
  await browser.close();
  server.close();
  if (failures.length) { console.error(`FAIL\n- ${failures.join('\n- ')}`); process.exit(1); }
  console.log(`PASS — ${Object.keys(TOOL_CHECKS).join(', ')} and hub, 390px and 1280px: no sideways scroll, no console errors, outputs live`);
})();
