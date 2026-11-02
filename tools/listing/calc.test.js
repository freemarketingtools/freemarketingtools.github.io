// Amazon listing checker: limits, title rules, bullet and description rules, search terms and claims.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS, TITLE_LIMITS, EXAMPLE, byteLength, counters, checkListing, verdict, problemList } = require('./calc.js');

const CLEAN = {
  brand: 'Northline',
  title: 'Northline Women’s Waterproof Rain Jacket with Hood, Packable, Black, Medium',
  bullets: [
    'Stays dry in downpours: a 3-layer shell with taped seams and a 20,000 mm waterproof rating.',
    'Packs down small: folds into its own chest pocket and weighs 9 oz.',
    'Breathes on the climb: pit zips let heat out without letting rain in.',
    'Fits over layers: a relaxed cut with room for a fleece underneath.',
    'Built to last: ripstop face fabric and YKK zips.'
  ],
  description: 'A packable rain shell for wet trails and rainy commutes. The hood fits over a helmet.',
  searchTerms: 'raincoat windbreaker anorak trekking outdoor ladies coat'
};
const listing = (over = {}) => ({ ...CLEAN, ...over });
const bullets = (...texts) => [...texts, ...CLEAN.bullets.slice(texts.length)];
const issuesOf = (over, options) => checkListing(listing(over), options).issues;
const withCode = (issues, code) => issues.filter((i) => i.code === code);
const matchTexts = (issues) => issues.flatMap((i) => i.matches.map((m) => m.text));

test('a clean listing has no issues and reads Ready to publish', () => {
  const result = checkListing(listing());
  assert.deepEqual(result.issues, [], JSON.stringify(result.issues, null, 2));
  assert.equal(verdict(result).level, 'ok');
  assert.equal(verdict(result).headline, 'Ready to publish');
});

test('byteLength counts UTF-8 bytes: an accented letter is 2, an emoji 4', () => {
  assert.equal(byteLength('rain coat'), 9);
  assert.equal(byteLength('imperméable'), 12);
  assert.equal(byteLength('☂'), 3);
  assert.equal(byteLength('🧥'), 4);
  assert.equal(byteLength(''), 0);
});

test('counters: characters for text fields, bytes for search terms, over only past the limit', () => {
  const c = counters(listing({
    title: 'x'.repeat(201), bullets: bullets('y'.repeat(255), 'z'.repeat(256)),
    description: 'd'.repeat(2001), searchTerms: 'é'.repeat(125)
  }));
  const byField = Object.fromEntries(c.map((x) => [x.field, x]));
  assert.deepEqual(byField.title, { field: 'title', count: 201, limit: 200, unit: 'characters', over: true });
  assert.equal(byField.bullet1.over, false, '255 is allowed');
  assert.equal(byField.bullet2.over, true);
  assert.equal(byField.description.over, true);
  assert.deepEqual(byField.searchTerms, { field: 'searchTerms', count: 250, limit: LIMITS.searchTermsBytes, unit: 'bytes', over: true, characters: 125 });
});

test('counters follow the chosen title limit', () => {
  const t = 'x'.repeat(90);
  assert.equal(counters(listing({ title: t }), 80).find((c) => c.field === 'title').over, true);
  assert.equal(counters(listing({ title: t }), 200).find((c) => c.field === 'title').over, false);
  assert.ok(TITLE_LIMITS.includes(200) && TITLE_LIMITS.includes(80));
});

test('over-limit fields are rejected with the count in the reason', () => {
  const issues = issuesOf({ title: `${CLEAN.title} ${'x'.repeat(130)}`, bullets: bullets('b'.repeat(300)), description: 'd'.repeat(2100), searchTerms: 'w '.repeat(130) });
  const over = withCode(issues, 'overLimit');
  assert.deepEqual(over.map((i) => i.field), ['title', 'bullet1', 'description', 'searchTerms']);
  assert.ok(over.every((i) => i.level === 'reject'));
  assert.match(over[0].reason, /206 characters.*200/);
  assert.match(over[3].reason, /260 bytes/);
});

test('switching the title limit re-checks the title', () => {
  const title = 'Northline Waterproof Rain Jacket for Women with Hood, Packable Lightweight Shell, Black, Medium';
  assert.equal(withCode(issuesOf({ title }, { titleLimit: 200 }), 'overLimit').length, 0);
  assert.equal(withCode(issuesOf({ title }, { titleLimit: 80 }), 'overLimit').length, 1);
});

test('title: a word used more than twice is rejected, ignoring case, with every occurrence matched', () => {
  const issues = issuesOf({ title: 'Northline Rain Jacket, Packable jacket for Hiking, Lightweight JACKET' });
  const repeated = withCode(issues, 'repeatedWord');
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].level, 'reject');
  assert.deepEqual(repeated[0].matches.map((m) => m.text), ['Jacket', 'jacket', 'JACKET']);
  assert.match(repeated[0].reason, /“jacket” 3 times/i);
});

test('title: small words and numbers may repeat; twice is fine', () => {
  const title = 'Northline Rain Jacket for Women and Men, for Hiking and Travel, for 3 Seasons, 3 Colors, 3 Sizes, Rain Hood';
  assert.equal(withCode(issuesOf({ title }), 'repeatedWord').length, 0);
});

test('title: banned special characters are rejected unless part of the brand', () => {
  const issues = issuesOf({ title: 'Northline Rain Jacket! Waterproof? Yes_ {Black}' });
  const special = withCode(issues, 'specialChar');
  assert.deepEqual(special.map((i) => i.matches[0].text), ['!', '?', '_', '{', '}']);
  assert.ok(special.every((i) => i.level === 'reject'));
  const brandOnly = issuesOf({ brand: 'Yahoo!', title: 'Yahoo! Rain Jacket, Black' });
  assert.equal(withCode(brandOnly, 'specialChar').length, 0, 'the ! inside the brand is allowed');
  const both = issuesOf({ brand: 'Yahoo!', title: 'Yahoo! Rain Jacket, Black!' });
  assert.equal(withCode(both, 'specialChar')[0].matches[0].start, 25, 'only the ! outside the brand');
});

test('title: ALL-CAPS words weaken it, but the brand, short words and sizes pass', () => {
  const issues = issuesOf({ brand: 'NORTHLINE', title: 'NORTHLINE Rain Jacket XXXL USA Made, WATERPROOF and PACKABLE' });
  const caps = withCode(issues, 'allCaps');
  assert.equal(caps.length, 1);
  assert.equal(caps[0].level, 'weak');
  assert.deepEqual(matchTexts(caps), ['WATERPROOF', 'PACKABLE']);
});

test('promotional wording is rejected in every field, with the exact phrase', () => {
  const issues = issuesOf({
    title: 'Northline Rain Jacket, Best Seller', bullets: bullets('Free shipping on every order.', 'Now 20% off for a limited time.'),
    description: 'The #1 rain jacket, on sale now.', searchTerms: 'raincoat cheapest'
  });
  const promo = withCode(issues, 'promo');
  assert.deepEqual(matchTexts(promo), ['Best Seller', 'Free shipping', '20% off', 'limited time', '#1', 'on sale', 'cheapest']);
  assert.ok(promo.every((i) => i.level === 'reject'));
});

test('promo words need whole words: wholesale, ideal and saleable pass', () => {
  const issues = issuesOf({ description: 'An ideal shell from a wholesale mill, with salesman-grade seams. Model #12.' });
  assert.deepEqual(issues, []);
});

test('banned claims: medical, FDA, pesticide-style and guarantees, each with its exact phrase', () => {
  const issues = issuesOf({
    bullets: bullets('Antibacterial lining that kills 99.9% of germs.', 'Mildew-resistant fabric.', 'Backed by our money-back guarantee.'),
    description: 'FDA approved fabric that relieves arthritis pain and treats eczema.'
  });
  assert.deepEqual(matchTexts(withCode(issues, 'pesticide')), ['Antibacterial', 'kills 99.9% of germs', 'Mildew-resistant']);
  assert.deepEqual(matchTexts(withCode(issues, 'guarantee')), ['money-back guarantee']);
  assert.deepEqual(matchTexts(withCode(issues, 'fda')), ['FDA approved']);
  assert.deepEqual(matchTexts(withCode(issues, 'medical')), ['relieves arthritis', 'treats eczema']);
  assert.ok(issues.every((i) => i.level === 'reject'));
});

test('claims stay quiet on ordinary product words: dog treats, epoxy cures, warranty', () => {
  const issues = issuesOf({ description: 'Pairs with dog treats in the pocket. The seam tape cures in 24 hours. Two-year warranty.' });
  assert.deepEqual(issues, []);
});

test('bullets and description: pricing and shipping talk is rejected', () => {
  const issues = issuesOf({ bullets: bullets('Only $49.99, our lowest price.', 'Ships within 24 hours.') });
  assert.deepEqual(matchTexts(withCode(issues, 'pricing')), ['$49.99']);
  assert.deepEqual(matchTexts(withCode(issues, 'promo')), ['lowest price']);
  assert.deepEqual(matchTexts(withCode(issues, 'shipping')), ['Ships']);
});

test('bullets and description: contact details and links are rejected', () => {
  const issues = issuesOf({ description: 'Questions? Email help@northline.com or call +1 (555) 010-2030. Sizing at www.northlinegear.com.' });
  assert.deepEqual(matchTexts(withCode(issues, 'contact')), ['help@northline.com', '+1 (555) 010-2030']);
  assert.deepEqual(matchTexts(withCode(issues, 'link')), ['www.northlinegear.com'], 'no trailing full stop, no double count of the email domain');
});

test('a measurement is not a phone number', () => {
  assert.deepEqual(issuesOf({ description: 'Rated 20,000 mm, 15000 g/m2/24h, size 10 x 12 x 14 in.' }), []);
});

test('one phrase is one problem: free shipping is promo, not shipping talk too', () => {
  const issues = issuesOf({ bullets: bullets('Free shipping included.') });
  assert.deepEqual(issues.map((i) => i.code), ['promo']);
});

test('a repeated bullet weakens the listing; empty bullets are not repeats', () => {
  const issues = issuesOf({ bullets: bullets(CLEAN.bullets[0], 'STAYS DRY IN DOWNPOURS: a 3-layer shell with taped seams and a 20,000 mm waterproof rating', '', '') });
  const dup = withCode(issues, 'duplicateBullet');
  assert.deepEqual(dup.map((i) => i.field), ['bullet2']);
  assert.equal(dup[0].level, 'weak');
  assert.match(dup[0].reason, /Bullet 2 repeats bullet 1/);
});

test('search terms: brand, words from the title or bullets, punctuation and subjective words weaken it', () => {
  const issues = issuesOf({ searchTerms: 'Northline, raincoat; waterproof jacket, amazing anorak' });
  assert.deepEqual(matchTexts(withCode(issues, 'brandInTerms')), ['Northline']);
  assert.deepEqual(matchTexts(withCode(issues, 'repeatsListing')), ['waterproof', 'jacket']);
  assert.deepEqual(matchTexts(withCode(issues, 'subjective')), ['amazing']);
  const punct = withCode(issues, 'punctuation');
  assert.deepEqual(matchTexts(punct), [',', ';', ',']);
  assert.match(punct[0].reason, /3 bytes/);
  assert.ok(issues.every((i) => i.level === 'weak'));
});

test('search terms: an accented word is fine; hyphens inside words are not punctuation', () => {
  assert.deepEqual(issuesOf({ searchTerms: 'imperméable chubasquero t-shirt' }), []);
});

test('issues carry offsets that point at their exact text', () => {
  const l = listing({ description: 'Sizing at www.northlinegear.com today.' });
  for (const issue of checkListing(l).issues) {
    for (const m of issue.matches) assert.equal(l.description.slice(m.start, m.end), m.text);
  }
});

test('verdict: counts blockers and weaker items, singular and plural', () => {
  const one = verdict(checkListing(listing({ title: 'Northline Rain Jacket!' })));
  assert.deepEqual(one, { level: 'reject', headline: '1 problem would block this listing', sub: '' });
  const weak = verdict(checkListing(listing({ searchTerms: 'raincoat, anorak' })));
  assert.deepEqual(weak, { level: 'weak', headline: 'Nothing would block this listing', sub: '1 thing weakens it.' });
});

test('the example listing shows 5 blockers and 5 weaker items', () => {
  const result = checkListing(EXAMPLE);
  assert.equal(result.reject, 5, JSON.stringify(result.issues.map((i) => [i.field, i.code]), null, 1));
  assert.equal(result.weak, 5);
  assert.equal(verdict(result).headline, '5 problems would block this listing');
  assert.equal(verdict(result).sub, 'Plus 5 things that weaken it.');
  assert.ok(byteLength(EXAMPLE.searchTerms) > [...EXAMPLE.searchTerms].length, 'the example shows bytes differ from characters');
});

test('problemList: headline, then one line per issue naming the field and the reason', () => {
  const text = problemList(checkListing(listing({ title: 'Northline Rain Jacket!', searchTerms: 'raincoat, anorak' })));
  const lines = text.split('\n');
  assert.equal(lines[0], '1 problem would block this listing');
  assert.equal(lines[1], '');
  assert.match(lines[2], /^Title \(blocks\): .*“!”/);
  assert.match(lines[3], /^Search terms \(weakens\): /);
  assert.equal(lines.length, 4);
});
