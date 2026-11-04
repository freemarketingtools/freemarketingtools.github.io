// Inbox preview logic: where each inbox cuts the subject and preheader, and the mistakes that don't error.
// The maths takes a measure(text, font) function, so these tests pass fakes instead of a browser canvas.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLIENTS, ELLIPSIS, FALLBACK_PREVIEW, EXAMPLE, fitLine, fitLines, keyOffer, inboxPreview, problemList, count
} = require('./calc.js');

// Every character (grapheme) is 10px wide, whatever the font: easy numbers for the fitting maths.
const tenPx = (text) => [...new Intl.Segmenter().segment(text)].length * 10;

// Roughly like real fonts: width scales with the font size, bold is wider.
const sized = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)[1]);
  const factor = /^[67]00 /.test(font) ? 0.6 : 0.55;
  return [...new Intl.Segmenter().segment(text)].length * size * factor;
};

const client = (result, id) => result.clients.find((c) => c.id === id);
const codes = (issues) => issues.map((i) => i.code);
const preview = (input) => inboxPreview({ sender: 'Northpeak', subject: 'Winter Sale: 40% off', preheader: 'Jackets and boots, ends tonight', ...input }, sized);

test('fitLine returns short text whole, with nothing hidden', () => {
  assert.deepEqual(fitLine('hello world', '', 200, tenPx), {
    lines: ['hello world'], text: 'hello world', visible: 'hello world', hidden: '', cut: false, cutIndex: 11
  });
});

test('fitLine cuts mid-word like a real inbox, puts … right after the last letter that fits, and hides the whole cut word', () => {
  const fit = fitLine('hello world', '', 95, tenPx);
  assert.equal(fit.text, `hello wo${ELLIPSIS}`);
  assert.equal(fit.visible, 'hello wo');
  assert.equal(fit.hidden, 'world', 'the hidden part starts at the word that got cut, so it reads naturally');
  assert.equal(fit.cut, true);
  assert.equal(fit.cutIndex, 8);
});

test('fitLine never leaves a space before the …', () => {
  const fit = fitLine('hello world', '', 75, tenPx);
  assert.equal(fit.text, `hello${ELLIPSIS}`);
  assert.equal(fit.hidden, 'world');
});

test('fitLine handles empty text, extra spaces and one long word', () => {
  assert.equal(fitLine('   ', '', 100, tenPx).text, '');
  assert.equal(fitLine('  a   b  ', '', 100, tenPx).text, 'a b');
  const long = fitLine('Supercalifragilistic', '', 55, tenPx);
  assert.equal(long.text, `Supe${ELLIPSIS}`);
  assert.equal(long.hidden, 'Supercalifragilistic');
});

test('fitLine counts an emoji family as one character, never splitting it', () => {
  const fit = fitLine('Hi 👨‍👩‍👧 there', '', 55, tenPx);
  assert.equal(fit.text, `Hi 👨‍👩‍👧${ELLIPSIS}`);
});

test('fitLines wraps whole words onto the first line and cuts only the last line', () => {
  const fit = fitLines('one two three four five six', '', 100, 2, tenPx);
  assert.deepEqual(fit.lines, ['one two', `three fou${ELLIPSIS}`]);
  assert.equal(fit.hidden, 'four five six');
  assert.equal(fit.visible, 'one two three fou');
  assert.equal(fit.cut, true);
});

test('fitLines leaves text that fits in two lines uncut', () => {
  const fit = fitLines('one two three', '', 100, 2, tenPx);
  assert.deepEqual(fit.lines, ['one two', 'three']);
  assert.equal(fit.cut, false);
  assert.equal(fit.hidden, '');
});

test('keyOffer finds the offer, preferring a discount over a plain number', () => {
  assert.deepEqual(keyOffer('Ends in 3 days: 40% off everything'), { text: '40% off', index: 16 });
  assert.equal(keyOffer('Take $20 off today').text, '$20 off');
  assert.equal(keyOffer('Free shipping this weekend').text, 'Free shipping');
  assert.equal(keyOffer('BOGO on every candle').text, 'BOGO');
  assert.equal(keyOffer('Half price boots').text, 'Half price');
  assert.equal(keyOffer('Our 2026 collection').text, '2026');
  assert.equal(keyOffer('Hello there'), null);
});

test('each inbox result keeps its own font and width settings, which the page draws the mock with', () => {
  inboxPreview(EXAMPLE, sized).clients.forEach((c, n) => {
    assert.equal(c.spec, CLIENTS[n]);
    assert.match(c.spec.subject.font, /px /, `${c.id} subject font survives the fitting`);
  });
});

test('every inbox is labelled with its screen size and its widths are estimates', () => {
  assert.deepEqual(CLIENTS.map((c) => c.id), ['gmailPhone', 'iphoneMail', 'outlookDesktop', 'gmailDesktop']);
  for (const c of CLIENTS) {
    assert.match(c.screen, /\d{3,4} (px|pt)/, `${c.id} names the screen it assumes`);
    for (const part of ['sender', 'subject', 'preview']) assert.ok(c[part].width > 0 && /px /.test(c[part].font), `${c.id} ${part}`);
  }
  assert.equal(CLIENTS.find((c) => c.id === 'iphoneMail').preview.lines, 2, 'Apple Mail shows 2 preview lines by default');
});

test('the example: the offer is cut on both phones and Outlook, whole on Gmail desktop, and the preheader loses words', () => {
  const result = inboxPreview(EXAMPLE, sized);
  assert.equal(result.verdict.headline, 'Your offer is cut off in 3 of 4 inboxes');
  assert.equal(result.verdict.level, 'fix');
  for (const id of ['gmailPhone', 'iphoneMail', 'outlookDesktop']) {
    assert.ok(codes(client(result, id).issues).includes('offerCut'), `${id} hides 40% off`);
  }
  for (const id of ['gmailPhone', 'outlookDesktop', 'gmailDesktop']) assert.ok(client(result, id).preview.cut, `${id} preheader is cut`);
  assert.equal(client(result, 'iphoneMail').preview.cut, false, 'Apple Mail’s two preview lines hold it');
  const desk = client(result, 'gmailDesktop');
  assert.equal(desk.subject.cut, false);
  assert.ok(codes(desk.issues).includes('previewCut'));
});

test('a hidden offer is explained in plain English, naming where the subject stops', () => {
  const iphone = client(inboxPreview(EXAMPLE, sized), 'iphoneMail');
  const issue = iphone.issues.find((i) => i.code === 'offerCut');
  assert.match(issue.text, /^Your subject stops at “Final hours of our Winter Sale, so [^”]*…”, so “40% off” is hidden\.$/);
  assert.equal(issue.level, 'fix');
});

test('hidden words that end a sentence are not followed by a second full stop', () => {
  const texts = inboxPreview(EXAMPLE, sized).clients.flatMap((c) => c.issues.map((i) => i.text));
  assert.ok(texts.some((t) => t.endsWith('returns.”')), 'the hidden end of the preheader is quoted as written');
  for (const t of texts) assert.doesNotMatch(t, /[.!?]”\.$/, t);
});

test('an offer only partly cut still counts as hidden', () => {
  // Outlook's subject shows 27 bold 14px characters here; "40% off" starts at 25 and is cut inside.
  const result = preview({ subject: 'Last call for winter, so 40% off today' });
  assert.ok(codes(client(result, 'outlookDesktop').issues).includes('offerCut'));
});

test('a cut subject with no offer is worth a look, listing the hidden words', () => {
  const result = preview({ subject: 'A long letter about our story and everything we believe in' });
  const issue = client(result, 'outlookDesktop').issues.find((i) => i.code === 'subjectCut');
  assert.equal(issue.level, 'look');
  assert.match(issue.text, /^Your subject stops at “.+…”\. Hidden: “.+”\.$/);
  assert.match(result.verdict.headline, /^Your subject is cut off in \d of 4 inboxes$/);
  assert.equal(result.verdict.level, 'look');
});

test('Gmail desktop shares one line: a long subject crowds the preheader out entirely', () => {
  const result = preview({ subject: 'x '.repeat(60) });
  const desk = client(result, 'gmailDesktop');
  assert.equal(desk.subject.cut, true);
  assert.equal(desk.preview.text, '');
  assert.equal(desk.preview.hidden, 'Jackets and boots, ends tonight');
  assert.ok(codes(desk.issues).includes('previewCrowdedOut'));
});

test('Gmail desktop gives the preheader whatever width the subject and " - " leave', () => {
  const desk = client(preview({}), 'gmailDesktop');
  const spec = CLIENTS.find((c) => c.id === 'gmailDesktop');
  assert.equal(desk.subject.cut, false);
  assert.equal(desk.preview.cut, false);
  assert.equal(desk.preview.room, spec.subject.width - sized('Winter Sale: 40% off', spec.subject.font) - sized(' - ', spec.preview.font));
});

test('an empty preheader shows the email’s first line in every inbox and is a coral check', () => {
  const result = preview({ preheader: '  ' });
  for (const c of result.clients) {
    assert.equal(c.preview.source, 'fallback');
    assert.ok(FALLBACK_PREVIEW.startsWith(c.preview.visible), `${c.id} shows the stand-in first line`);
  }
  const issue = result.issues.find((i) => i.code === 'previewEmpty');
  assert.equal(issue.level, 'fix');
  assert.match(issue.text, /View this email in your browser/);
});

test('a preheader that repeats the subject is a coral check', () => {
  for (const preheader of ['Winter Sale: 40% off', 'winter sale 40% off everything', 'Sale: 40% off winter']) {
    assert.ok(codes(preview({ preheader }).issues).includes('previewRepeats'), preheader);
  }
  assert.ok(!codes(preview({}).issues).includes('previewRepeats'));
  assert.equal(preview({ preheader: 'Winter Sale: 40% off' }).verdict.headline, 'Your preview text repeats the subject');
});

test('a short preheader is worth a look: inboxes fill the rest with the email’s first words', () => {
  assert.ok(codes(preview({ preheader: 'Shop now' }).issues).includes('previewShort'));
  assert.ok(!codes(preview({}).issues).includes('previewShort'));
});

test('ALL CAPS, piled-up !!! and many emoji are worth a look', () => {
  assert.ok(codes(preview({ subject: 'HUGE SALE today only' }).issues).includes('allCaps'));
  assert.ok(codes(preview({ subject: 'WINTER SALE IS ON' }).issues).includes('allCaps'));
  assert.ok(!codes(preview({ subject: 'Our USA store is open' }).issues).includes('allCaps'), 'one short acronym is fine');
  assert.ok(codes(preview({ subject: 'Sale is on!!' }).issues).includes('punctuation'));
  assert.ok(codes(preview({ subject: 'Big! Bold! Now!' }).issues).includes('punctuation'));
  assert.ok(!codes(preview({ subject: 'Sale is on!' }).issues).includes('punctuation'));
  assert.ok(codes(preview({ subject: '🔥 Sale 🔥 now 🎉' }).issues).includes('emoji'));
  assert.ok(!codes(preview({ subject: '🔥 Sale now 👨‍👩‍👧' }).issues).includes('emoji'), 'two emoji, the family counted once');
});

test('spam trigger words are flagged as a guide, not a rule', () => {
  const issue = preview({ subject: 'Act now: guaranteed savings', preheader: 'Click here to see the deal before Sunday ends' }).issues.find((i) => i.code === 'spamWords');
  assert.equal(issue.level, 'look');
  assert.match(issue.text, /“act now”, “guaranteed”, “click here”/);
  assert.match(issue.text, /guide, not a rule/);
  assert.ok(!codes(preview({ subject: 'Contract now signed' }).issues).includes('spamWords'), 'whole words only');
});

test('an empty subject or sender is flagged', () => {
  const noSubject = preview({ subject: '' });
  assert.equal(noSubject.verdict.headline, 'Add a subject line');
  assert.ok(codes(noSubject.issues).includes('subjectEmpty'));
  assert.ok(codes(preview({ sender: '' }).issues).includes('senderEmpty'));
});

test('a long sender name is cut and worth a look', () => {
  const result = preview({ sender: 'Northpeak Outfitters Official Store Europe Ltd' });
  assert.ok(codes(client(result, 'gmailDesktop').issues).includes('senderCut'));
});

test('a clean email fits every inbox in full', () => {
  const result = preview({});
  assert.equal(result.verdict.headline, 'Fits every inbox in full');
  assert.equal(result.verdict.level, 'ok');
  assert.equal(result.clients.flatMap((c) => c.issues).length + result.issues.length, 0);
});

test('only small leftovers: the subject fits, with a count of what is worth a look', () => {
  const result = preview({ sender: '' });
  assert.equal(result.verdict.headline, 'Your subject fits every inbox');
  assert.equal(result.verdict.sub, '1 worth a look');
});

test('the problem list starts with the verdict and names the inbox and level on every line', () => {
  const text = problemList(inboxPreview(EXAMPLE, sized));
  const [headline, blank, ...lines] = text.split('\n');
  assert.equal(headline, 'Your offer is cut off in 3 of 4 inboxes');
  assert.equal(blank, '');
  assert.match(lines[0], /^Gmail on a phone \(to fix\): Your subject stops at “/);
  assert.ok(lines.some((l) => /^Gmail on desktop \(worth a look\): Your preheader stops at “/.test(l)));
  assert.ok(lines.every((l) => /^(Gmail on a phone|Apple Mail on an iPhone|Outlook on desktop|Gmail on desktop|Every inbox) \((to fix|worth a look)\): /.test(l)));
});

test('count counts what a person sees: an emoji family is one character', () => {
  assert.equal(count('Hi 👨‍👩‍👧'), 4);
  assert.equal(count('  a  '), 1);
});
