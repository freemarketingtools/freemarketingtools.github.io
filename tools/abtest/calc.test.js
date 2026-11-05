// The statistics are checked against published values, not against themselves:
// normal-table quantiles, R's documented power.prop.test examples, Kohavi's rule of thumb and
// his book's sample-ratio-mismatch example, plus a z-test cross-checked with an independent
// Pearson chi-square. Then the plain-English verdicts and checks, scenario by scenario.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalCdf, normalQuantile, zTest, liftRange, sampleSize, power, detectableLift, srmTest,
  readCheck, readPlan, checkTest, planTest, checkSummary, planSummary, EXAMPLE
} = require('./calc.js');

const close = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected ${expected} ± ${tolerance}`);

const DEFAULTS = { confidence: 0.95, power: 0.8, multiplier: 1 };
const run = (values, options = {}) => checkTest(values, { ...DEFAULTS, ...options });
const levels = (result) => result.checks.map((c) => `${c.level}:${c.code}`);

// --- The normal distribution (standard normal table values) ---

test('normalCdf matches standard normal table values to 9 decimals', () => {
  close(normalCdf(0), 0.5, 1e-12, 'Φ(0)');
  close(normalCdf(1), 0.8413447460685429, 1e-9, 'Φ(1)');
  close(normalCdf(1.96), 0.9750021048517795, 1e-9, 'Φ(1.96)');
  close(normalCdf(-2.5758293035489004), 0.005, 1e-9, 'Φ(−2.5758)');
  close(normalCdf(-8), 6.22096057427178e-16, 1e-20, 'Φ(−8), far tail');
  close(normalCdf(3) + normalCdf(-3), 1, 1e-15, 'Φ(3) + Φ(−3)');
});

test('normalQuantile gives the textbook critical values', () => {
  close(normalQuantile(0.975), 1.959963984540054, 1e-9, 'z for 95% two-sided');
  close(normalQuantile(0.995), 2.5758293035489004, 1e-9, 'z for 99% two-sided');
  close(normalQuantile(0.95), 1.6448536269514722, 1e-9, 'z for 90% two-sided');
  close(normalQuantile(0.8), 0.8416212335729143, 1e-9, 'z for 80% power');
  close(normalQuantile(0.9), 1.2815515655446004, 1e-9, 'z for 90% power');
  close(normalQuantile(0.001), -3.090232306167813, 1e-9, 'lower tail');
});

// --- Two-proportion z-test ---

test('zTest on a hand-worked example agrees with an independent Pearson chi-square', () => {
  const r = zTest(10000, 200, 10000, 250);
  close(r.pA, 0.02, 1e-12, 'rate A');
  close(r.pB, 0.025, 1e-12, 'rate B');
  // pooled p = 0.0225, SE = sqrt(0.0225 * 0.9775 * 2 / 10000) = 0.00209732, z = 0.005 / SE
  close(r.z, 2.38399, 1e-4, 'z');
  close(r.pValue, 0.01713, 1e-4, 'two-sided p');
  // Pearson chi-square on the 2x2 table, computed the long way: Σ (observed − expected)² / expected.
  const table = [[200, 9800], [250, 9750]];
  const total = 20000;
  const colSum = [450, 19550];
  let chi = 0;
  for (const row of table) for (let j = 0; j < 2; j++) {
    const expected = (10000 * colSum[j]) / total;
    chi += (row[j] - expected) ** 2 / expected;
  }
  close(r.z * r.z, chi, 1e-9, 'z² equals the uncorrected chi-square');
});

test('zTest is symmetric and says zero when the rates are equal', () => {
  const ahead = zTest(5000, 150, 5000, 180);
  const behind = zTest(5000, 180, 5000, 150);
  close(ahead.z, -behind.z, 1e-12, 'swapping A and B flips z');
  close(ahead.pValue, behind.pValue, 1e-12, 'and keeps p');
  const same = zTest(5000, 150, 5000, 150);
  assert.equal(same.z, 0);
  assert.equal(same.pValue, 1);
});

// --- Range on the relative lift (log risk ratio) ---

test('liftRange brackets the observed lift and narrows with more data', () => {
  const small = liftRange(2000, 60, 2000, 75, 0.95);
  const big = liftRange(200000, 6000, 200000, 7500, 0.95);
  close(small.lift, 0.25, 1e-12, 'observed lift');
  assert.ok(small.low < 0.25 && small.high > 0.25, 'range contains the estimate');
  assert.ok(small.low < 0, 'a 75-vs-60 test cannot rule out no difference');
  assert.ok(big.low > 0.2 && big.high < 0.3, `with 100x the data the range is tight: ${big.low}–${big.high}`);
  const wider = liftRange(2000, 60, 2000, 75, 0.99);
  assert.ok(wider.low < small.low && wider.high > small.high, '99% is wider than 95%');
});

test('liftRange has no range when a variant has no conversions', () => {
  assert.deepEqual(liftRange(1000, 0, 1000, 5, 0.95), { lift: null, low: null, high: null });
});

// --- Sample size and power (R power.prop.test, Kohavi) ---

test('sampleSize matches R power.prop.test(p1 = .5, p2 = .75, power = .9): n = 76.7', () => {
  close(sampleSize(0.5, 0.75, { confidence: 0.95, power: 0.9 }), 76.7, 0.05, 'n per group');
});

test('power matches R power.prop.test(n = 50, p1 = .5, p2 = .75): power = 0.740', () => {
  close(power(50, 0.5, 0.75, 0.95), 0.7401659, 1e-4, 'power');
});

test('sampleSize is within 1% of Kohavi’s 16σ²/δ² rule: 5% rate, 5% lift → 121,600 per variant', () => {
  const n = sampleSize(0.05, 0.0525, { confidence: 0.95, power: 0.8 });
  assert.ok(Math.abs(n - 121600) / 121600 < 0.01, `got ${n}`);
});

test('sampleSize grows for stricter settings and is infinite when there is no difference', () => {
  const base = sampleSize(0.03, 0.033, { confidence: 0.95, power: 0.8 });
  assert.ok(sampleSize(0.03, 0.033, { confidence: 0.99, power: 0.8 }) > base, '99% needs more');
  assert.ok(sampleSize(0.03, 0.033, { confidence: 0.95, power: 0.9 }) > base, '90% power needs more');
  assert.equal(sampleSize(0.03, 0.03, { confidence: 0.95, power: 0.8 }), Infinity);
});

test('detectableLift inverts sampleSize', () => {
  const n = sampleSize(0.04, 0.044, { confidence: 0.95, power: 0.8 });
  close(detectableLift(0.04, n, { confidence: 0.95, power: 0.8 }), 0.1, 1e-4, 'smallest provable lift');
});

// --- Sample ratio mismatch (Kohavi, Tang & Xu 2020, chapter 3 example) ---

test('srmTest reproduces Kohavi’s example: 821,588 vs 815,482 users, p ≈ 1.8e-6', () => {
  const r = srmTest(821588, 815482);
  close(r.pValue, 1.8e-6, 0.05e-6, 'p-value');
  assert.equal(r.mismatch, true);
});

test('srmTest lets an ordinary split through', () => {
  const r = srmTest(5030, 4970);
  assert.equal(r.mismatch, false);
  close(r.shareA, 0.503, 1e-9, 'share A');
});

// --- Reading what people type ---

test('readCheck takes thousands separators and rejects impossible numbers', () => {
  const ok = readCheck({ visitorsA: '4,800', conversionsA: '144', visitorsB: '4 820', conversionsB: '167', days: '5' });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.values, { visitorsA: 4800, conversionsA: 144, visitorsB: 4820, conversionsB: 167, days: 5 });
  const bad = readCheck({ visitorsA: '0', conversionsA: '1.5', visitorsB: 'lots', conversionsB: '900', days: '0' });
  assert.deepEqual(bad.errors, { visitorsA: 'needVisitors', conversionsA: 'notWhole', visitorsB: 'notANumber', days: 'needDays' });
  const over = readCheck({ visitorsA: '100', conversionsA: '101', visitorsB: '100', conversionsB: '5', days: '7' });
  assert.deepEqual(over.errors, { conversionsA: 'moreThanVisitors' });
});

test('readPlan rejects a lift that would push the rate past 100%', () => {
  assert.deepEqual(readPlan({ baseline: '3,2', lift: '10', daily: '2,000' }).values, { baseline: 3.2, lift: 10, daily: 2000 });
  assert.deepEqual(readPlan({ baseline: '60', lift: '80', daily: '100' }).errors, { lift: 'overHundred' });
  assert.deepEqual(readPlan({ baseline: '0', lift: '-5', daily: '0' }).errors, { baseline: 'needRate', lift: 'needLift', daily: 'needVisitors' });
});

// --- Check my test: the verdict sentence and the checks ---

test('the prefilled example looks like a win but is not significant yet, with days left', () => {
  const r = run(readCheck(EXAMPLE).values);
  assert.equal(r.verdict, 'keepGoing');
  assert.equal(r.leader, 'B');
  assert.equal(r.sure, 'not sure yet');
  assert.ok(r.confidence > 0.85 && r.confidence < 0.95, `looks close to a win: ${r.confidence}`);
  assert.ok(r.daysLeft >= 7 && r.daysLeft <= 14, `days left ${r.daysLeft}`);
  assert.match(r.sentence, /^B converts 1\d% better than A so far, but you can’t be sure yet\. Keep it running about \d+ more days at your current traffic\.$/);
  assert.deepEqual(levels(r), ['fix:short']);
});

test('more traffic shortens the days left, less traffic lengthens them', () => {
  const values = readCheck(EXAMPLE).values;
  const now = run(values).daysLeft;
  const double = run(values, { multiplier: 2 });
  assert.ok(double.daysLeft < now && run(values, { multiplier: 0.5 }).daysLeft > now);
  assert.match(double.sentence, /about \d+ more days at [\d,]+ visitors a day\.$/);
});

test('a clear, full-sample, full-week winner says stop', () => {
  const r = run({ visitorsA: 30000, conversionsA: 900, visitorsB: 30000, conversionsB: 1080, days: 14 });
  assert.equal(r.verdict, 'win');
  assert.equal(r.sure, 'sure');
  assert.equal(r.daysLeft, 0);
  assert.equal(r.sentence, 'B converts 20% better than A, and you can be sure. Stop the test: B won.');
  assert.deepEqual(r.checks, []);
});

test('A can win too, and the sentence names A', () => {
  const r = run({ visitorsA: 30000, conversionsA: 1080, visitorsB: 30000, conversionsB: 900, days: 14 });
  assert.equal(r.leader, 'A');
  assert.equal(r.sentence, 'A converts 20% better than B, and you can be sure. Stop the test: keep A.');
});

test('significant before the planned sample is peeking: fairly sure, keep going', () => {
  const r = run({ visitorsA: 6000, conversionsA: 180, visitorsB: 6000, conversionsB: 230, days: 7 });
  assert.ok(r.significant, `p = ${r.pValue}`);
  assert.ok(r.neededPerVariant > 6000);
  assert.equal(r.verdict, 'early');
  assert.equal(r.sure, 'fairly sure');
  assert.match(r.sentence, /^B converts 28% better than A, and you can be fairly sure, but it’s too early to call\. Keep it running about \d+ more days at your current traffic\.$/);
  assert.ok(levels(r).includes('fix:peeking'));
});

test('a huge lift on tiny numbers is never called a win', () => {
  const r = run({ visitorsA: 60, conversionsA: 2, visitorsB: 60, conversionsB: 12, days: 3 });
  assert.ok(r.significant, 'the z-test alone would call it');
  assert.notEqual(r.verdict, 'win');
  assert.ok(levels(r).includes('fix:tooFew') && levels(r).includes('fix:short'));
});

test('a broken split is called broken before anything else', () => {
  const r = run({ visitorsA: 10800, conversionsA: 324, visitorsB: 9200, conversionsB: 330, days: 14 });
  assert.equal(r.verdict, 'broken');
  assert.equal(r.sure, 'not sure yet');
  assert.equal(r.sentence, 'Don’t trust this test: A got 54% of the visitors instead of half, so the split is broken. Fix it and start again.');
  assert.equal(levels(r)[0], 'fix:srm');
});

test('a difference too small for any sensible test is a tie', () => {
  const r = run({ visitorsA: 20000, conversionsA: 600, visitorsB: 20000, conversionsB: 606, days: 14 });
  assert.equal(r.verdict, 'tie');
  assert.equal(r.sentence, 'B is only 1% ahead and you can’t be sure. Call it a tie: even a big test would not show a difference this small at your traffic.');
  assert.ok(levels(r).includes('look:tooSmall'));
});

test('the 8-week cap moves with traffic: a tie today becomes worth running at 4x the visitors', () => {
  const values = { visitorsA: 40000, conversionsA: 1200, visitorsB: 40000, conversionsB: 1265, days: 28 };
  const today = run(values);
  assert.ok(!today.significant && today.days === undefined, `p ${today.pValue}`);
  assert.equal(today.verdict, 'tie');
  assert.ok(today.daysLeft + 28 > 56, `needs ${today.daysLeft} more days`);
  const busier = run(values, { multiplier: 4 });
  assert.equal(busier.verdict, 'keepGoing');
  assert.ok(busier.daysLeft + 28 <= 56, `needs ${busier.daysLeft} more days`);
  assert.match(busier.sentence, /^B converts 5% better than A so far, but you can’t be sure yet\. Keep it running about \d+ more days at 11,429 visitors a day\.$/);
});

test('equal rates are a tie, and zero conversions means not enough data', () => {
  assert.equal(run({ visitorsA: 5000, conversionsA: 150, visitorsB: 5000, conversionsB: 150, days: 14 }).sentence,
    'A and B convert exactly the same so far. Call it a tie: even a big test would not show a difference this small at your traffic.');
  const none = run({ visitorsA: 400, conversionsA: 0, visitorsB: 400, conversionsB: 3, days: 2 });
  assert.equal(none.verdict, 'noData');
  assert.equal(none.lift, null);
  assert.equal(none.sentence, 'Not enough data yet: A has no conversions, so there is nothing to compare. Keep the test running.');
});

test('a test that ends mid-week gets an amber note naming the whole-week day', () => {
  const r = run({ visitorsA: 30000, conversionsA: 900, visitorsB: 30000, conversionsB: 1080, days: 10 });
  const week = r.checks.find((c) => c.code === 'partialWeek');
  assert.equal(week.level, 'look');
  assert.match(week.text, /day 14/);
  assert.equal(r.verdict, 'win');
});

test('the small-numbers note says how far one conversion moves the lift', () => {
  const r = run({ visitorsA: 2000, conversionsA: 50, visitorsB: 2000, conversionsB: 60, days: 7 });
  const note = r.checks.find((c) => c.code === 'smallNumbers');
  assert.match(note.text, /^With 50 conversions in A, one more or one less moves the lift by about 2 points\.$/);
});

test('a stricter confidence turns a 95% win into an early call', () => {
  const values = { visitorsA: 12000, conversionsA: 360, visitorsB: 12000, conversionsB: 430, days: 14 };
  assert.equal(run(values).significant, true);
  assert.equal(run(values, { confidence: 0.99 }).significant, false);
});

// --- Plan a test ---

test('planTest gives visitors per version and whole weeks', () => {
  const p = planTest({ baseline: 3, lift: 10, daily: 2000 }, DEFAULTS);
  close(p.perVariant, sampleSize(0.03, 0.033, DEFAULTS), 1, 'per variant');
  assert.equal(p.total, p.perVariant * 2);
  assert.equal(p.days, Math.ceil(p.perVariant / 1000));
  assert.equal(p.weeks, Math.ceil(p.days / 7));
  assert.equal(p.tooLong, false);
  assert.match(p.sentence, /^You need about [\d,]+ visitors per version \([\d,]+ in total\)\. At 2,000 visitors a day that’s \d+ days, so plan for \d+ full weeks\.$/);
});

test('planTest never plans less than a week', () => {
  const p = planTest({ baseline: 10, lift: 50, daily: 20000 }, DEFAULTS);
  assert.equal(p.weeks, 1);
  assert.match(p.sentence, /plan for 1 full week\.$/);
});

test('planTest says when a lift is too small for the traffic, and what it can prove', () => {
  const p = planTest({ baseline: 2, lift: 5, daily: 500 }, DEFAULTS);
  assert.equal(p.tooLong, true);
  assert.ok(p.detectable > 0.05, `in 8 weeks it can prove ${p.detectable}`);
  assert.match(p.sentence, /^At 500 visitors a day a \+5% lift would take about \d+ weeks to prove, too long for a fair test\. In 8 weeks this traffic can prove a lift of about \+\d+% or more\.$/);
  assert.equal(p.checks[0].level, 'fix');
});

// --- Copy summary ---

test('the check summary is the verdict plus the numbers, ready for Slack', () => {
  const r = run(readCheck(EXAMPLE).values);
  const text = checkSummary(r, DEFAULTS);
  const lines = text.split('\n');
  assert.equal(lines[0], 'A/B test check (95% confidence, 80% power)');
  assert.equal(lines[1], r.sentence);
  assert.match(text, /\nA: [\d,]+ visitors, [\d,]+ conversions \(\d\.\d\d%\)\nB: /);
  assert.match(text, /\nLift: \+\d+\.\d% \(range [−+]\d+\.\d% to \+\d+\.\d%\)\nConfidence: \d+%\n/);
  assert.match(text, /\nChecks:\n- Don’t trust yet: /);
  assert.doesNotMatch(text, /NaN|undefined|Infinity/);
});

test('the plan summary carries the sentence and the plan', () => {
  const p = planTest({ baseline: 3, lift: 10, daily: 2000 }, DEFAULTS);
  const text = planSummary(p, { baseline: 3, lift: 10, daily: 2000 }, DEFAULTS);
  assert.match(text, /^A\/B test plan \(95% confidence, 80% power\)\nYou need about/);
  assert.match(text, /\nNow converting: 3%\nSmallest lift that matters: \+10%\nDaily visitors: 2,000\n/);
});
