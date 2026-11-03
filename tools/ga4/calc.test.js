// GA4 event name checks: what GA4 rejects or drops, what splits reports, and the one-click fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS, EXAMPLE, parseList, checkList, verdict, problemList, fixList, snakeName } = require('./calc.js');

const issuesOf = (text, name) => {
  const event = checkList(text).events.find((e) => e.name === name);
  assert.ok(event, `no event named ${name}`);
  return event.issues;
};
const codes = (text, name) => issuesOf(text, name).map((i) => i.code);
const levelOf = (text, name) => checkList(text).events.find((e) => e.name === name).level;

// --- Reading the pasted list ---

test('reads name: params lines, comma rows, tab rows from a sheet and a bare column', () => {
  const rows = parseList('add_to_cart: currency, value, items\npurchase,transaction_id,value\nlogin\tmethod\nsearch');
  assert.deepEqual(rows.map((r) => [r.line, r.name, r.params, r.style]), [
    [1, 'add_to_cart', ['currency', 'value', 'items'], 'colon'],
    [2, 'purchase', ['transaction_id', 'value'], 'comma'],
    [3, 'login', ['method'], 'tab'],
    [4, 'search', [], 'comma']
  ]);
});

test('skips blank lines and a header row, strips quotes and empty cells, keeps the real line numbers', () => {
  const rows = parseList('Event name,Parameters\n\n"view_item","currency",,\n  sign_up  :  method ,\n');
  assert.deepEqual(rows.map((r) => [r.line, r.name, r.params]), [[3, 'view_item', ['currency']], [4, 'sign_up', ['method']]]);
});

test('an empty box has nothing to check and says so', () => {
  const result = checkList('  \n\n');
  assert.equal(result.total, 0);
  assert.equal(verdict(result).level, 'empty');
  assert.match(verdict(result).headline, /Paste your events/);
});

// --- Event name rules (GA4 rejects or drops these) ---

test('a valid name passes clean', () => {
  assert.deepEqual(codes('newsletter_signup: form_location', 'newsletter_signup'), []);
  assert.equal(levelOf('newsletter_signup', 'newsletter_signup'), 'ok');
});

test('a name over 40 characters is rejected; exactly 40 is fine', () => {
  const name41 = 'a'.repeat(LIMITS.name + 1);
  assert.deepEqual(codes(name41, name41), ['tooLong']);
  assert.match(issuesOf(name41, name41)[0].text, /41 characters/);
  assert.deepEqual(codes('a'.repeat(LIMITS.name), 'a'.repeat(LIMITS.name)), []);
});

test('a name must start with a letter', () => {
  assert.deepEqual(codes('2nd_image_swipe', '2nd_image_swipe'), ['badStart']);
  assert.ok(codes('_hidden', '_hidden').includes('badStart'));
});

test('spaces, dashes and dots are rejected, each named in plain words', () => {
  const issue = issuesOf('my event-name.v2', 'my event-name.v2').find((i) => i.code === 'badChars');
  assert.equal(issue.level, 'reject');
  assert.match(issue.text, /a space/);
  assert.match(issue.text, /a dash/);
  assert.match(issue.text, /a dot/);
});

test('non-English letters are allowed in names, as Google’s naming page says', () => {
  assert.deepEqual(codes('compra_realizada_ñ', 'compra_realizada_ñ'), []);
});

test('reserved names GA4 sends itself are rejected, on both stream types', () => {
  for (const name of ['session_start', 'first_visit', 'user_engagement', 'first_open', 'app_remove', 'notification_open', 'error']) {
    assert.deepEqual(codes(name, name), ['reserved'], name);
  }
  assert.match(issuesOf('session_start', 'session_start')[0].text, /Remove this line/);
});

test('app-only names are rejected and labelled as a web-stream problem', () => {
  for (const name of ['screen_view', 'in_app_purchase', 'ad_impression']) {
    const [issue] = issuesOf(name, name);
    assert.equal(issue.code, 'appOnly', name);
    assert.equal(issue.level, 'reject');
    assert.equal(issue.stream, 'web');
  }
});

test('names GA4 collects itself on web are a warning, not a rejection', () => {
  const [issue] = issuesOf('page_view', 'page_view');
  assert.equal(issue.code, 'autoCollected');
  assert.equal(issue.level, 'weak');
  assert.equal(issue.stream, 'web');
  assert.match(issue.text, /twice/);
});

test('google_, ga_ and firebase_ prefixes are rejected, with the web side labelled an estimate', () => {
  for (const name of ['google_review_click', 'ga_scroll_depth', 'firebase_login']) {
    const issue = issuesOf(name, name).find((i) => i.code === 'reservedPrefix');
    assert.ok(issue, name);
    assert.equal(issue.level, 'reject');
    assert.match(issue.text, /estimate/);
  }
});

test('a line with parameters but no name is rejected', () => {
  const result = checkList(': currency, value');
  assert.equal(result.events[0].issues[0].code, 'noName');
});

// --- Parameter rules ---

test('parameter names follow the same 40-character, letter-first, characters rule', () => {
  const text = `view_item: ${'p'.repeat(41)}, 9lives, item id, items`;
  const params = issuesOf(text, 'view_item').filter((i) => i.param).map((i) => [i.param, i.code]);
  assert.deepEqual(params, [['p'.repeat(41), 'tooLong'], ['9lives', 'badStart'], ['item id', 'badChars']]);
});

test('reserved parameter prefixes are rejected without also calling out the underscore start', () => {
  const text = 'view_item: _review_source, ga_session, google_x, firebase_y, gtag.z';
  const params = issuesOf(text, 'view_item').map((i) => [i.param, i.code]);
  assert.deepEqual(params, [['_review_source', 'reservedPrefix'], ['ga_session', 'reservedPrefix'],
    ['google_x', 'reservedPrefix'], ['firebase_y', 'reservedPrefix'], ['gtag.z', 'reservedPrefix']]);
});

test('more than 25 parameters on one event is flagged with how many GA4 ignores', () => {
  const params = Array.from({ length: 27 }, (_, i) => `p${i}`).join(', ');
  const issue = issuesOf(`custom_event: ${params}`, 'custom_event').find((i) => i.code === 'tooManyParams');
  assert.equal(issue.level, 'reject');
  assert.match(issue.text, /27 parameters/);
  assert.match(issue.text, /other 2/);
  assert.equal(issuesOf(`custom_event: ${Array.from({ length: 25 }, (_, i) => `p${i}`).join(',')}`, 'custom_event').length, 0);
});

// --- The quiet report-wreckers ---

test('names that differ only by case or style are grouped as separate events', () => {
  const text = 'add_to_cart\nAdd_To_Cart\naddToCart\nadd-to-cart';
  const result = checkList(text);
  assert.equal(result.events.find((e) => e.name === 'add_to_cart').level, 'ok', 'the right spelling is not blamed');
  for (const name of ['Add_To_Cart', 'addToCart', 'add-to-cart']) {
    const split = issuesOf(text, name).find((i) => i.code === 'split');
    assert.ok(split, name);
    assert.equal(split.level, 'weak');
    assert.match(split.text, /4 separate events/);
    assert.match(split.text, /add_to_cart/);
  }
});

test('a custom name split by style picks the snake_case spelling already in the list', () => {
  const text = 'newsletter_signup\nNewsletterSignup';
  assert.equal(levelOf(text, 'newsletter_signup'), 'ok');
  assert.match(issuesOf(text, 'NewsletterSignup').find((i) => i.code === 'split').text, /newsletter_signup/);
});

test('near-misses of recommended names suggest the real name and say what is lost', () => {
  const cases = [
    ['addtocart', 'add_to_cart', /ecommerce reports/],
    ['purchase_complete', 'purchase', /revenue/],
    ['begin-checkout', 'begin_checkout', /ecommerce reports/],
    ['Purchase', 'purchase', /revenue/],
    ['initiate_checkout', 'begin_checkout', /ecommerce reports/],
    ['view_product', 'view_item', /ecommerce reports/],
    ['signup', 'sign_up', /built-in/],
    ['lead', 'generate_lead', /lead reports/],
    ['view_items', 'view_item', /ecommerce reports/]
  ];
  for (const [name, recommended, loss] of cases) {
    const issue = issuesOf(name, name).find((i) => i.code === 'nearMiss');
    assert.ok(issue, name);
    assert.equal(issue.level, 'weak');
    assert.equal(issue.suggestion, recommended, name);
    assert.match(issue.text, loss, name);
  }
});

test('exact recommended names and unrelated look-alikes are not near-misses', () => {
  for (const name of ['purchase', 'sign_up', 'login', 'sign_in_click', 'newsletter_signup', 'view_item_list']) {
    assert.ok(!codes(name, name).includes('nearMiss'), name);
  }
  assert.equal(issuesOf('sign_in', 'sign_in').find((i) => i.code === 'nearMiss').suggestion, 'login');
});

test('a duplicate line is flagged once, not counted as a second event', () => {
  const result = checkList('view_item: currency\nlogin\nview_item: currency\nview_item');
  assert.equal(result.total, 2);
  assert.deepEqual(result.duplicates, [{ name: 'view_item', lines: [1, 3, 4] }]);
  assert.deepEqual(result.lines.map((l) => l.duplicateOf), [null, null, 1, 1]);
  assert.equal(result.reject + result.weak, 0);
});

// --- The example and the verdict ---

test('the example opens on 7 of 15 events, 5 rejected and 2 weakening, plus 1 duplicate', () => {
  const result = checkList(EXAMPLE);
  assert.equal(result.total, 15);
  assert.equal(result.reject, 5);
  assert.equal(result.weak, 2);
  assert.equal(result.duplicates.length, 1);
  const v = verdict(result);
  assert.equal(v.level, 'reject');
  assert.equal(v.headline, '7 of 15 events would break your reports');
  assert.equal(v.sub, '5 GA4 would reject or drop · 2 split or weaken reports · 1 duplicate line');
});

test('verdict wording for a clean list, a single event and duplicates only', () => {
  assert.equal(verdict(checkList('login\nsign_up')).headline, 'All 2 events follow GA4’s rules');
  assert.equal(verdict(checkList('login')).headline, 'Your 1 event follows GA4’s rules');
  assert.equal(verdict(checkList('login\nsession_start')).headline, '1 of 2 events would break your reports');
  const dupes = verdict(checkList('login\nlogin'));
  assert.equal(dupes.level, 'weak');
  assert.equal(dupes.headline, 'No event would break your reports');
  assert.equal(dupes.sub, '1 duplicate line to tidy up.');
});

test('the problem list starts with the verdict and gives one line per problem', () => {
  const text = problemList(checkList('login\nsession_start\nPurchase\nlogin'));
  const lines = text.split('\n');
  assert.equal(lines[0], '2 of 3 events would break your reports');
  assert.equal(lines[1], '');
  assert.match(lines[2], /^Line 2, session_start \(GA4 rejects\): /);
  assert.ok(lines.some((l) => /^Line 3, Purchase \(weakens reports\): .*purchase/.test(l)));
  assert.ok(lines.some((l) => /^Line 4, login \(duplicate\): Listed 2 times \(lines 1 and 4\)/.test(l)));
});

// --- Fix names ---

test('snakeName turns any spelling into a valid snake_case name', () => {
  assert.equal(snakeName('addToCart'), 'add_to_cart');
  assert.equal(snakeName('Add-To-Cart'), 'add_to_cart');
  assert.equal(snakeName('  begin   checkout! '), 'begin_checkout');
  assert.equal(snakeName('Café Visit'), 'cafe_visit');
  assert.equal(snakeName('google_review_click'), 'review_click');
  assert.equal(snakeName('google_'), 'event');
  assert.equal(snakeName('2nd_image_swipe'), 'event_2nd_image_swipe');
  assert.equal(snakeName('product_size_guide_opened_from_quick_view'), 'product_size_guide_opened_from_quick');
  assert.equal(snakeName('x'.repeat(50)), 'x'.repeat(40));
  assert.equal(snakeName('_review_source', 'param'), 'review_source');
});

test('Fix names rewrites the example, maps near-misses, merges what became the same event', () => {
  const fixed = fixList(EXAMPLE);
  assert.equal(fixed.text, [
    'view_item_list: item_list_id, item_list_name, items',
    'view_item: currency, value, items',
    'select_item: item_list_name, items',
    'add_to_cart: currency, value, items',
    'add_to_wishlist: currency, value, items',
    'view_cart: currency, value, items',
    'begin_checkout: currency, value, coupon, items',
    'add_shipping_info: currency, value, shipping_tier, items',
    'purchase: transaction_id, currency, value, tax, shipping, items',
    'newsletter_signup: form_location',
    'session_start',
    'review_click: review_source',
    'product_size_guide_opened_from_quick: product_id'
  ].join('\n'));
  const byLine = Object.fromEntries(fixed.changes.map((c) => [c.line, c]));
  assert.deepEqual(byLine[5], { line: 5, before: 'addToCart: currency, value, items', after: 'add_to_cart: currency, value, items', mergedInto: 4 });
  assert.equal(byLine[9].after, 'begin_checkout: currency, value, coupon, items');
  assert.equal(byLine[16].mergedInto, 2);
  assert.equal(byLine[1], undefined, 'unchanged lines are not listed');
  assert.equal(verdict(checkList(fixed.text)).headline, '1 of 13 events would break your reports');
});

test('Fix names keeps tab and comma rows in their own format, merging parameters', () => {
  const fixed = fixList('Add To Cart\tcurrency\tvalue\nadd_to_cart\titems\nPurchase,value,currency');
  assert.equal(fixed.text, 'add_to_cart\tcurrency\tvalue\titems\npurchase,value,currency');
});

test('Fix names keeps blank lines and the header, and running it twice changes nothing more', () => {
  const once = fixList('event name\n\naddToCart: Item ID\nsearch').text;
  assert.equal(once, 'event name\n\nadd_to_cart: item_id\nsearch');
  assert.equal(fixList(once).text, once);
  assert.equal(fixList(fixList(EXAMPLE).text).text, fixList(EXAMPLE).text);
  assert.deepEqual(fixList(once).changes, []);
});
