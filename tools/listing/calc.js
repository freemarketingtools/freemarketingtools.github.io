// Checks an Amazon listing (title, bullets, description, backend search terms) against Amazon's limits
// and listing rules. Runs in the browser (inlined by scripts/build.mjs, exposed as window.ListingCalc)
// and in Node (tests).
//
// Amazon's own pages (Seller Central help is behind a login, and rules vary by category):
//   Product title requirements      sellercentral.amazon.com/help/hub/reference/external/GYTR6SYGFA5E3EQC
//     Announced for January 21, 2025: titles may not exceed 200 characters for most categories; the
//     special characters ! $ ? _ { } ^ ¬ ¦ are not allowed unless part of the brand; the same word may
//     not appear more than twice, with prepositions, articles and conjunctions exempt.
//   Use search terms effectively    sellercentral.amazon.com/help/hub/reference/external/G23501
//     Under 250 bytes; no brand names, punctuation or subjective claims like "amazing"; don't repeat words.
//   Category style guides           sellercentral.amazon.com/help/hub/reference/external/G200270100
//   Restricted products             sellercentral.amazon.com/help/hub/reference/external/G200164330
//     Pesticide claims (antibacterial, antimicrobial), drug and medical claims, FDA approval claims.
//
// Estimates, not published numbers: the 255-character bullet and 2,000-character description limits
// (common figures for most categories; some allow more), the ALL-CAPS rule (4+ letters), every phrase
// list below (our own list of common offenders; Amazon reviews claims by judgement), and counting only
// words with a letter in them for the repeated-word rule.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ListingCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { title: 200, bullet: 255, description: 2000, searchTermsBytes: 249 };
  const TITLE_LIMITS = [200, 150, 125, 100, 80, 50];
  const BULLETS = 5;
  const MAX_REPEATS = 2;
  const PHONE_DIGITS = { min: 10, max: 15 };
  const BULLET_FIELDS = Array.from({ length: BULLETS }, (_, i) => [`bullet${i + 1}`, `Bullet ${i + 1}`]);
  const FIELD_NAMES = Object.fromEntries([['title', 'Title'], ...BULLET_FIELDS, ['description', 'Description'], ['searchTerms', 'Search terms']]);
  const FIELD_ORDER = Object.keys(FIELD_NAMES);

  const SMALL_WORDS = new Set(('a an the and or but nor so yet for of in on at to by with from into onto over under ' +
    'up upon via within without about above across after against along among around before behind below ' +
    'beneath beside between beyond down during except inside like near off out past per since through ' +
    'toward towards until &').split(' '));

  const CONDITIONS = '(?:acne|anxiety|arthritis|cancer|colds?|covid(?:-19)?|depression|diabetes|diseases?|eczema|flu|illness(?:es)?|infections?|insomnia|pain)';
  const CLAIMS = [
    { code: 'medical', pattern: new RegExp(`\\b(?:(?:cures?|cured|treats?|prevents?|relieves?|heals?) (?:the )?${CONDITIONS}|cure for|pain relief|anti-?inflammatory|clinically proven|doctor recommended)\\b`, 'gi'),
      reason: (t) => `Medical claim “${t}”. Amazon removes listings that say a product cures, treats or prevents a condition.` },
    { code: 'fda', pattern: /\b(?:fda[- ](?:approved|cleared|certified|registered)|approved by the fda)\b/gi,
      reason: (t) => `“${t}”. Amazon doesn’t allow claims of FDA approval.` },
    { code: 'pesticide', pattern: /\b(?:anti-?bacterial|anti-?microbial|anti-?fungal|anti-?viral|kills? (?:\d+(?:\.\d+)?% of )?(?:germs|bacteria|viruses|fungus|mold|mould|bugs|insects)|disinfect(?:s|ing|ant)?|saniti[sz](?:e|es|ed|ing|er)|(?:mold|mould|mildew)[- ]resistant|repels? (?:bugs|insects|mosquitoes|ticks|fleas)|insect repellent)\b/gi,
      reason: (t) => `“${t}” is a pesticide claim. Amazon blocks it unless the product is registered with the EPA.` },
    { code: 'guarantee', pattern: /\b(?:money[- ]back guarantee|satisfaction guaranteed|money[- ]back|guarantee[ds]?|risk[- ]free|full refund)\b/gi,
      reason: (t) => `“${t}” is a guarantee. Amazon doesn’t allow guarantees in a listing.` },
    { code: 'promo', pattern: /(?:\bbest[- ]sell(?:er|ers|ing)\b|(?<![\w#])#1\b|\bnumber one\b|\bfree (?:shipping|delivery|returns|gift)\b|\b\d+\s?% off\b|\bon sale\b|\bsale price\b|\blimited[- ]time\b|\bhot (?:item|deal|sale)\b|\bbuy now\b|\border now\b|\bcheapest\b|\b(?:lowest|best) (?:price|deal)\b)/gi,
      reason: (t) => `Promotional wording “${t}”. Amazon doesn’t allow it in a listing.` }
  ];

  const PROSE_RULES = [
    { code: 'contact', pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\+?\(?\d[\d\s().-]{8,}\d|\b(?:call|text|email|contact) us\b/gi, keep: isContact,
      reason: (t) => `Contact details “${t}”. Amazon doesn’t allow them in a listing.` },
    { code: 'link', pattern: /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|shop|store|us|uk|de)\b(?:\/\S*)?/gi, trim: true,
      reason: (t) => `Link “${t}”. Amazon doesn’t allow web addresses in a listing.` },
    { code: 'pricing', pattern: /[$€£¥]\s?\d(?:[\d,.]*\d)?|\b\d(?:[\d,.]*\d)?\s?(?:dollars|usd|eur|euros?)\b|\b(?:prices?|priced|pricing|discount(?:s|ed)?|coupons?|cheaper)\b/gi,
      reason: (t) => `Pricing talk “${t}”. Prices belong in the offer, not the listing text.` },
    { code: 'shipping', pattern: /\b(?:ships?|shipped|shipping|delivery|delivered|in stock|out of stock)\b/gi,
      reason: (t) => `Shipping talk “${t}”. Amazon doesn’t allow shipping details in the listing text.` }
  ];

  const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
  const HAS_LETTER = /\p{L}/u;
  const SPECIAL = /[!$?_{}^¬¦]/g;
  const ALL_CAPS = /\b[A-Z]{4,}\b/g;
  const SIZE = /^X+[LS]$/;
  const SUBJECTIVE = /\b(?:best|amazing|awesome|perfect|great|excellent|incredible|fantastic|premium|(?:good|high|top) quality)\b/gi;
  const PUNCTUATION = /[,;:.|/\\!?"()[\]{}+*#&]/g;
  const TRAILING = /[.,;:!?)]+$/;

  const count = (n) => n.toLocaleString('en-US');
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
  const quoted = (words) => words.map((w) => `“${w}”`).join(', ');
  const chars = (text) => [...text].length;
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function byteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  function isContact(text) {
    if (/@|\bus$/i.test(text)) return true;
    const digits = text.replace(/\D/g, '').length;
    return digits >= PHONE_DIGITS.min && digits <= PHONE_DIGITS.max;
  }

  // --- Matching helpers: every match keeps its offsets, so the page can highlight it in place ---

  // trim drops a full stop or bracket a sentence put after a link.
  function findAll(text, pattern, { keep, trim } = {}) {
    const found = [];
    for (const m of text.matchAll(pattern)) {
      const t = trim ? m[0].replace(TRAILING, '') : m[0];
      if (t && (!keep || keep(t))) found.push({ start: m.index, end: m.index + t.length, text: t });
    }
    return found;
  }

  function words(text) {
    return findAll(text, WORD).filter((w) => HAS_LETTER.test(w.text));
  }

  function brandPattern(brand) {
    const b = brand.trim();
    return b ? new RegExp(`(?<![\\p{L}\\p{N}])${escape(b)}(?![\\p{L}\\p{N}])`, 'giu') : null;
  }

  const issue = (field, level, code, reason, matches = []) => ({ field, level, code, reason, matches });
  const perMatch = (field, level, rule, text) =>
    findAll(text, rule.pattern, rule).map((m) => issue(field, level, rule.code, rule.reason(m.text), [m]));

  // --- Field rules ---

  function overLimit(field, text, limit) {
    const n = field === 'searchTerms' ? byteLength(text) : chars(text);
    if (n <= limit) return [];
    const unit = field === 'searchTerms' ? 'bytes' : 'characters';
    const why = field === 'searchTerms'
      ? `Search terms use ${count(n)} bytes. Amazon reads under 250 and may ignore the whole field when it’s over.`
      : `${FIELD_NAMES[field]} has ${count(n)} ${unit}. The limit is ${count(limit)}.`;
    return [issue(field, 'reject', 'overLimit', why)];
  }

  const claims = (field, text) => CLAIMS.flatMap((rule) => perMatch(field, 'reject', rule, text));

  // Matches grouped by a key, in order of first appearance.
  function groupBy(matches, keyOf) {
    const groups = new Map();
    for (const m of matches) {
      const key = keyOf(m);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups];
  }

  function repeatedWords(text) {
    const counted = words(text).filter((w) => !SMALL_WORDS.has(w.text.toLowerCase()));
    return groupBy(counted, (w) => w.text.toLowerCase()).filter(([, found]) => found.length > MAX_REPEATS).map(([key, found]) =>
      issue('title', 'reject', 'repeatedWord', `The title uses “${key}” ${found.length} times. Amazon allows the same word twice at most.`, found));
  }

  function specialChars(text, brand) {
    const pattern = brandPattern(brand);
    const masked = pattern ? text.replace(pattern, (b) => ' '.repeat(b.length)) : text;
    return groupBy(findAll(masked, SPECIAL), (m) => m.text).map(([c, found]) =>
      issue('title', 'reject', 'specialChar', `“${c}” isn’t allowed in a title unless it’s part of the brand.`, found));
  }

  function allCaps(text, brand) {
    const brandWords = new Set(words(brand).map((w) => w.text.toLowerCase()));
    const found = findAll(text, ALL_CAPS).filter((m) => !SIZE.test(m.text) && !brandWords.has(m.text.toLowerCase()));
    if (found.length === 0) return [];
    return [issue('title', 'weak', 'allCaps', `ALL-CAPS ${quoted(found.map((m) => m.text))}. Amazon’s style guides ask for normal capitals.`, found)];
  }

  const titleIssues = ({ title, brand }, titleLimit) => [
    overLimit('title', title, titleLimit), claims('title', title), specialChars(title, brand),
    repeatedWords(title), allCaps(title, brand)
  ];

  const proseIssues = (field, text, limit) => [
    overLimit(field, text, limit), claims(field, text), ...PROSE_RULES.map((rule) => perMatch(field, 'reject', rule, text))
  ];

  const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  function duplicateBullets(bullets) {
    const seen = new Map();
    const found = [];
    bullets.forEach((text, i) => {
      const key = normalize(text);
      if (!key) return;
      if (seen.has(key)) found.push(issue(`bullet${i + 1}`, 'weak', 'duplicateBullet', `Bullet ${i + 1} repeats bullet ${seen.get(key) + 1}. Use it to say something new.`));
      else seen.set(key, i);
    });
    return found;
  }

  function grouped(field, code, found, reason) {
    return found.length ? [issue(field, 'weak', code, reason(found), found)] : [];
  }

  function searchTermIssues({ searchTerms: text, brand, title, bullets }) {
    const pattern = brandPattern(brand);
    const listed = new Set([title, ...bullets].flatMap((t) => words(t)).map((w) => w.text.toLowerCase()));
    const repeats = words(text).filter((w) => listed.has(w.text.toLowerCase()) && !SMALL_WORDS.has(w.text.toLowerCase()));
    const unique = (found) => [...new Set(found.map((m) => m.text.toLowerCase()))];
    return [
      overLimit('searchTerms', text, LIMITS.searchTermsBytes), claims('searchTerms', text),
      grouped('searchTerms', 'brandInTerms', pattern ? findAll(text, pattern) : [], () => 'Your brand is already indexed. Leave it out of the search terms.'),
      grouped('searchTerms', 'repeatsListing', repeats, (f) => `${quoted(unique(f))} ${f.length === 1 ? 'is' : 'are'} already in the title or bullets, so ${f.length === 1 ? 'it wastes' : 'they waste'} space here.`),
      grouped('searchTerms', 'subjective', findAll(text, SUBJECTIVE), (f) => `Subjective ${quoted(unique(f))}. Amazon asks you to leave words like these out.`),
      grouped('searchTerms', 'punctuation', findAll(text, PUNCTUATION), (f) => `${plural(f.length, 'punctuation mark')} ${f.length === 1 ? 'wastes' : 'waste'} ${plural(f.length, 'byte')}. Separate words with spaces.`)
    ];
  }

  // In one field, a stretch of text is one problem: the first rule to claim it keeps it.
  function dedupe(groups) {
    const taken = [];
    const overlaps = (m) => taken.some((t) => m.start < t.end && t.start < m.end);
    const kept = [];
    for (const found of groups.flat()) {
      if (found.matches.length === 0) { kept.push(found); continue; }
      const matches = found.matches.filter((m) => !overlaps(m));
      if (matches.length === 0) continue;
      taken.push(...matches);
      kept.push(matches.length === found.matches.length ? found : { ...found, matches });
    }
    return kept;
  }

  function checkListing(listing, { titleLimit = LIMITS.title } = {}) {
    const l = { brand: '', title: '', description: '', searchTerms: '', ...listing, bullets: listing.bullets || [] };
    const issues = [
      ...dedupe(titleIssues(l, titleLimit)),
      ...l.bullets.flatMap((text, i) => dedupe(proseIssues(`bullet${i + 1}`, text, LIMITS.bullet))),
      ...duplicateBullets(l.bullets),
      ...dedupe(proseIssues('description', l.description, LIMITS.description)),
      ...dedupe(searchTermIssues(l))
    ];
    issues.sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
    const reject = issues.filter((i) => i.level === 'reject').length;
    return { issues, reject, weak: issues.length - reject };
  }

  function counters(listing, titleLimit = LIMITS.title) {
    const row = (field, text, limit) => ({ field, count: chars(text), limit, unit: 'characters', over: chars(text) > limit });
    const bytes = byteLength(listing.searchTerms);
    return [
      row('title', listing.title, titleLimit),
      ...listing.bullets.map((text, i) => row(`bullet${i + 1}`, text, LIMITS.bullet)),
      row('description', listing.description, LIMITS.description),
      { field: 'searchTerms', count: bytes, limit: LIMITS.searchTermsBytes, unit: 'bytes', over: bytes > LIMITS.searchTermsBytes, characters: chars(listing.searchTerms) }
    ];
  }

  function verdict({ reject, weak }) {
    const weakens = (n) => `${plural(n, 'thing')} ${n === 1 ? 'weakens' : 'weaken'} it`;
    if (reject) {
      return { level: 'reject', headline: `${plural(reject, 'problem')} would block this listing`, sub: weak ? `Plus ${plural(weak, 'thing')} that ${weak === 1 ? 'weakens' : 'weaken'} it.` : '' };
    }
    if (weak) return { level: 'weak', headline: 'Nothing would block this listing', sub: `${weakens(weak)}.` };
    return { level: 'ok', headline: 'Ready to publish', sub: 'Nothing Amazon would reject or suppress.' };
  }

  function problemList(result) {
    const lines = result.issues.map((i) => `${FIELD_NAMES[i.field]} (${i.level === 'reject' ? 'blocks' : 'weakens'}): ${i.reason}`);
    return [verdict(result).headline, '', ...lines].join('\n');
  }

  const EXAMPLE = {
    brand: 'Northline',
    title: 'Northline Women’s Waterproof Rain Jacket, Packable Hooded Jacket for Hiking & Travel, Lightweight Shell Jacket!',
    bullets: [
      'STAYS DRY IN DOWNPOURS: a 3-layer shell with fully taped seams and a 20,000 mm waterproof rating keeps you dry on long hikes.',
      'PACKS DOWN SMALL: folds into its own chest pocket and weighs just 9 oz, so it fits in any daypack.',
      'FRESH ON THE TRAIL: an antimicrobial lining fights odor on multi-day trips.',
      'BUILT TO LAST: ripstop face fabric and YKK zips, backed by our money-back guarantee.',
      'PACKS DOWN SMALL: folds into its own chest pocket and weighs just 9 oz, so it fits in any daypack.'
    ],
    description: 'The Northline Storm Shell is built for wet trails and rainy commutes. Pit zips dump heat on the climb, the hood fits over a helmet, and the whole jacket packs into its own pocket. Sizing help at www.northlinegear.com.',
    searchTerms: 'northline, rain coat, waterproof jacket, best rain jacket for women, raincoat hiking, packable windbreaker, imperméable, lightweight shell'
  };

  return { LIMITS, TITLE_LIMITS, BULLETS, FIELD_NAMES, EXAMPLE, byteLength, counters, checkListing, verdict, problemList };
});
