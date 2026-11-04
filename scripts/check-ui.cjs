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

// --- Safe zones: the example's verdict, toggles, hide UI, copy, and real files under the Share's sandbox ---

const EXAMPLE_HEADLINE = '3 of 5 platforms would cover your text';
const zoneLevels = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.phone-card')]
  .map((c) => [c.dataset.platform, [...c.querySelectorAll('.zone')].filter((z) => z.dataset.level === 'covered').length])));

// A test picture made in the page itself: a plain card with a word drawn at a height (0-1) of the frame.
const pictureFile = (page, [width, height, textAt]) => page.evaluate(([w, h, at]) => new Promise((resolve) => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d');
  g.fillStyle = '#d8dde2'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#111'; g.font = `800 ${Math.round(w / 9)}px sans-serif`; g.textAlign = 'center';
  g.fillText('SALE 50%', w / 2, h * at);
  c.toBlob((b) => b.arrayBuffer().then((buf) => resolve(Array.from(new Uint8Array(buf)))), 'image/png');
}), [width, height, textAt]).then((bytes) => Buffer.from(bytes));

// A real WebM recorded in the page, with a caption at 73-78% of the height that changes every frame:
// under TikTok's caption and both Reels and Shorts, just above Stories' 80%.
const recordedVideo = (page) => page.evaluate(() => new Promise((resolve) => {
  const c = Object.assign(document.createElement('canvas'), { width: 540, height: 960 });
  const g = c.getContext('2d');
  const recorder = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => new Blob(chunks).arrayBuffer().then((buf) => resolve(Array.from(new Uint8Array(buf))));
  let frame = 0;
  const draw = () => {
    g.fillStyle = '#20303a'; g.fillRect(0, 0, 540, 960);
    g.fillStyle = '#fff'; g.font = '800 64px sans-serif'; g.fillText(`BUY NOW ${frame++}`, 60, 750);
  };
  draw();
  const timer = setInterval(draw, 33);
  recorder.start();
  setTimeout(() => { clearInterval(timer); recorder.stop(); }, 1200);
}));

const dropFile = (page, name, type, bytes) => page.evaluate(([n, t, b]) => {
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array(b)], n, { type: t }));
  for (const kind of ['dragover', 'drop']) document.body.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: data }));
}, [name, type, Array.from(bytes)]);

async function checkSafezoneExample(page) {
  if (await page.textContent('#headline') !== EXAMPLE_HEADLINE) return `example headline: ${await page.textContent('#headline')}`;
  const covered = await zoneLevels(page);
  const expected = { tiktok: 0, reels: 1, stories: 0, fbreels: 1, shorts: 1 };
  if (JSON.stringify(covered) !== JSON.stringify(expected)) return `covered zones per platform: ${JSON.stringify(covered)}`;
  if (await page.locator('#checks .check[data-level="reject"]').count() !== 3) return 'expected 3 coral checks';
  if (await page.locator('#checks .check[data-level="ok"]').count() !== 2) return 'expected 2 clear checks';
  if (!/Clear on TikTok/.test(await page.textContent('#phones'))) return 'TikTok preview does not say Clear';
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.phone-card[data-platform="reels"] canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit;
  });
  return painted > 1000 ? null : 'the example was not drawn into the preview';
}

async function checkSafezoneControls(page) {
  await page.click('label.toggle:has(#on-reels)');
  if (await page.textContent('#headline') !== '2 of 4 platforms would cover your text') return `with Reels off: ${await page.textContent('#headline')}`;
  if (await page.isVisible('.phone-card[data-platform="reels"]')) return 'Reels preview stayed visible when switched off';
  await page.click('label.toggle:has(#on-reels)');
  if (await page.textContent('#headline') !== EXAMPLE_HEADLINE) return 'switching Reels back on did not restore the verdict';
  await page.click('label.switch');
  if (await page.isVisible('.phone-card[data-platform="tiktok"] .ui')) return 'Show app buttons off did not hide the mock UI';
  if (!await page.isVisible('.phone-card[data-platform="tiktok"] .zone')) return 'hiding the mock UI hid the zones too';
  await page.click('label.switch');
  if (page.viewportSize().width < 720) {
    const swipe = await page.evaluate(() => { const p = document.getElementById('phones'); return p.scrollWidth > p.clientWidth && getComputedStyle(p).overflowX === 'auto'; });
    if (!swipe) return 'previews are not a swipeable row on a phone';
  }
  return null;
}

async function checkSafezoneFiles(page) {
  await page.setInputFiles('#file', { name: 'square.png', mimeType: 'image/png', buffer: await pictureFile(page, [1080, 1080, 0.5]) });
  await headlineIs(page, 'No platform covers your text');
  if (!/Read square\.png in your browser · 1080×1080 image/.test(await page.textContent('#file-status'))) return `square pick: ${await page.textContent('#file-status')}`;
  if (!/1:1 is letterboxed: it fills 56% of the screen height, with black bars/.test(await page.textContent('#checks'))) return 'square was not called letterboxed';
  await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  if (!/isn’t a PNG, JPEG, WebP, MP4 or WebM/.test(await page.textContent('#file-status'))) return 'wrong file type was not refused';
  await dropFile(page, 'dropped.png', 'image/png', await pictureFile(page, [720, 1280, 0.9]));
  await headlineIs(page, '5 of 5 platforms would cover your text');
  if (!/Only 720 pixels wide/.test(await page.textContent('#checks'))) return 'a 720px image was not flagged as soft';
  await dropFile(page, 'clip.webm', 'video/webm', await recordedVideo(page));
  await headlineIs(page, '4 of 5 platforms would cover your text');
  if (!/Read clip\.webm in your browser · 540×960 video/.test(await page.textContent('#file-status'))) return `video: ${await page.textContent('#file-status')}`;
  if (!/Only 540 pixels wide/.test(await page.textContent('#checks'))) return 'the 540px video was not flagged as soft';
  const frame = () => page.evaluate(() => {
    const c = document.querySelector('.phone-card[data-platform="tiktok"] canvas');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.reduce((a, b, i) => (a * 31 + b * (i % 97)) % 1e9, 7);
  });
  const first = await frame();
  await page.waitForTimeout(600);
  if (await frame() === first) return 'the video does not play in the previews';
  await page.click('#use-example');
  return await page.textContent('#headline') === EXAMPLE_HEADLINE ? null : 'Back to the example did not restore it';
}

async function checkSafezone(page) {
  return await checkSafezoneExample(page)
    || await checkProblemListCopy(page, /^3 of 5 platforms would cover your text\n\nInstagram Reels \(covered\): Something important may sit under the caption area on Instagram Reels\.\n/)
    || await checkSafezoneControls(page) || await checkSafezoneFiles(page);
}

// --- GA4: the example's verdict and marks, copy, Fix names with before/after and Undo, edits ---

const GA4_EXAMPLE_HEADLINE = '7 of 15 events would break your reports';

async function checkGa4Example(page) {
  if (await page.textContent('#headline') !== GA4_EXAMPLE_HEADLINE) return `example headline: ${await page.textContent('#headline')}`;
  if (await page.locator('#checks .check[data-level="reject"]').count() !== 5) return 'expected 5 coral event cards';
  if (await page.locator('#checks .check[data-level="weak"]').count() !== 3) return 'expected 3 amber cards (2 events and 1 duplicate)';
  const marks = await page.locator('#lines mark').allTextContents();
  for (const text of ['addToCart', 'add-to-cart', 'begin checkout', 'session_start', '_review_source', 'purchase_complete']) {
    if (!marks.includes(text)) return `“${text}” is not marked in the list: ${JSON.stringify(marks)}`;
  }
  return null;
}

async function checkGa4Fix(page) {
  await page.click('#fix');
  if (!/^begin_checkout: currency, value, coupon, items$/m.test(await page.inputValue('#events'))) return 'Fix names did not rewrite begin checkout';
  if (await page.textContent('#headline') !== '1 of 13 events would break your reports') return `after Fix names: ${await page.textContent('#headline')}`;
  if (await page.locator('#changes li').count() !== 7) return `before/after lists ${await page.locator('#changes li').count()} lines, expected 7`;
  if (!/Merged into line 4/.test(await page.textContent('#changes'))) return 'merged lines are not explained';
  await stubClipboard(page, true);
  await page.click('#copy-fixed');
  if (await page.evaluate(() => window.__copied) !== await page.inputValue('#events')) return 'Copy fixed list did not copy the fixed list';
  const scroll = await sidewaysScroll(page);
  if (scroll > 0) return `before/after scrolls sideways by ${scroll}px`;
  await page.click('#undo');
  if (await page.textContent('#headline') !== GA4_EXAMPLE_HEADLINE || await page.isVisible('#fixed')) return 'Undo did not restore the example';
  return null;
}

async function checkGa4Edits(page) {
  await page.fill('#events', 'page_view');
  if (!/web streams/.test(await page.textContent('#checks'))) return 'a web-only rule is not labelled web streams';
  await page.fill('#events', 'login\nsign_up');
  if (await page.textContent('#headline') !== 'All 2 events follow GA4’s rules') return `clean list: ${await page.textContent('#headline')}`;
  if (await page.isHidden('#clear') || !await page.isDisabled('#copy')) return 'clean list did not show all clear with Copy off';
  await page.click('#fix');
  return /Nothing to fix/.test(await page.textContent('#fix-status')) ? null : 'Fix names on a clean list did not say nothing to fix';
}

async function checkGa4(page) {
  return await checkGa4Example(page)
    || await checkProblemListCopy(page, /^7 of 15 events would break your reports\n\nLine 5, addToCart \(weakens reports\): Close to Google’s recommended add_to_cart\./)
    || await checkGa4Fix(page) || await checkGa4Edits(page);
}

// --- Inbox: the example's verdict and cuts in real fonts, dark mode, the silent mistakes, a clean email ---

const INBOX_EXAMPLE_HEADLINE = 'Your offer is cut off in 3 of 4 inboxes';
const mockText = (page, client, part) => page.textContent(`.inbox[data-client="${client}"] .${part}`);

async function checkInboxExample(page) {
  if (await page.textContent('#headline') !== INBOX_EXAMPLE_HEADLINE) return `example headline: ${await page.textContent('#headline')}`;
  if (await page.locator('#checks .check[data-level="fix"]').count() !== 3) return 'expected 3 coral inbox cards';
  if (await page.locator('#checks .check[data-level="look"]').count() !== 1) return 'expected 1 amber inbox card (Gmail desktop)';
  for (const client of ['gmailPhone', 'iphoneMail', 'outlookDesktop']) {
    if (!(await mockText(page, client, 'subject')).endsWith('…')) return `${client} mock does not cut the subject`;
  }
  if ((await mockText(page, 'gmailDesktop', 'subject')).endsWith('…')) return 'Gmail desktop mock cut a subject that fits';
  if (!/so “40% off” is hidden/.test(await page.textContent('#checks'))) return 'the hidden offer is not named';
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('.inbox[data-client="iphoneMail"] .subject')).fontSize);
  if (font !== '15px') return `Apple Mail subject is drawn at ${font}, not its 15px`;
  if (await page.locator('#sources li').count() !== 4) return 'Where the numbers come from does not list all 4 inboxes';
  const swipe = await page.evaluate(() => { const w = document.querySelector('.inbox[data-client="gmailDesktop"] .frame-wrap'); return w.scrollWidth > w.clientWidth; });
  if (swipe !== (page.viewportSize().width < 720)) return `Gmail desktop mock swipes: ${swipe}`;
  return null;
}

async function checkInboxDark(page) {
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('.inbox[data-client="gmailPhone"] .mock')).backgroundColor);
  const light = await background();
  await page.focus('#dark');
  await page.keyboard.press('Space');
  if (await page.getAttribute('#dark', 'aria-checked') !== 'true' || await page.getAttribute('#previews', 'data-theme') !== 'dark') return 'Dark mode switch did not turn on from the keyboard';
  return await background() !== light ? null : 'dark mode did not restyle the mocks';
}

async function checkInboxEdits(page) {
  await page.fill('#preheader', '');
  if (!/View this email in your browser/.test(await mockText(page, 'gmailPhone', 'soft'))) return 'empty preheader did not show the first line of the email';
  if (!/No preheader/.test(await page.textContent('#checks'))) return 'empty preheader was not flagged';
  await page.fill('#preheader', 'Final hours of our Winter Sale');
  if (!/repeats the subject/.test(await page.textContent('#checks'))) return 'a preheader repeating the subject was not flagged';
  await page.fill('#subject', 'Winter Sale: 40% off');
  await page.fill('#preheader', 'Jackets and boots, ends tonight');
  if (await page.textContent('#headline') !== 'Fits every inbox in full') return `clean email: ${await page.textContent('#headline')}`;
  if (await page.isHidden('#clear') || !await page.isDisabled('#copy')) return 'clean email did not show all clear with Copy off';
  if (await page.textContent('#count-subject') !== '20 characters') return `subject counter: ${await page.textContent('#count-subject')}`;
  const scroll = await sidewaysScroll(page);
  return scroll > 0 ? `edited page scrolls sideways by ${scroll}px` : null;
}

async function checkInbox(page) {
  return await checkInboxExample(page)
    || await checkProblemListCopy(page, /^Your offer is cut off in 3 of 4 inboxes\n\nGmail on a phone \(to fix\): Your subject stops at “Final hours of our Winter Sale/)
    || await checkInboxDark(page) || await checkInboxEdits(page);
}

const TOOL_CHECKS = { roas: checkRoas, utm: checkUtm, serp: checkSerp, rsa: checkRsa, feed: checkFeed, listing: checkListing, safezone: checkSafezone, ga4: checkGa4, inbox: checkInbox };

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
