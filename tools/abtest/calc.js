// A/B test maths, answered in plain English. Runs in the browser (inlined by scripts/build.mjs,
// exposed as window.AbCalc) and in Node (tests). Fixed-horizon test, one primary metric, 50/50 split.
//
// Sources (the tests check each against its published values):
// - Normal CDF: Hart (1968) algorithm 5666 as given by West, "Better approximations to cumulative
//   normal functions" (Wilmott, 2005). Inverse: Acklam's rational approximation (2003) plus one
//   Halley refinement step.
// - Significance: the pooled two-proportion z-test, two-sided (Fleiss, Levin & Paik, "Statistical
//   Methods for Rates and Proportions", 3rd ed., 2003; equal to R's prop.test without continuity
//   correction). "Confidence" is 1 − p-value, the way marketing tools label it.
// - Range on the lift: the log risk-ratio interval (Katz, Baptista, Azen & Pike, Biometrics, 1978).
// - Sample size and power: the closed form R's power.prop.test solves (strict = FALSE); its docs give
//   n = 76.7 for p1 = .5, p2 = .75, power = .9. Close to Kohavi's 16σ²/δ² rule of thumb (Kohavi,
//   Longbotham, Sommerfield & Henne, "Controlled experiments on the web", 2009).
// - Sample ratio mismatch: chi-square goodness of fit against 50/50, flagged at p < 0.001 (Fabijan
//   et al., "Diagnosing Sample Ratio Mismatch in Online Controlled Experiments", KDD 2019; Kohavi,
//   Tang & Xu, "Trustworthy Online Controlled Experiments", 2020, ch. 3 and 21).
// - Peeking: stopping at the first significant result inflates false wins (Evan Miller, "How Not
//   To Run an A/B Test", 2010). Whole weeks: day-of-week effects (Kohavi, Tang & Xu, 2020).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AbCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PERCENT = 100;
  const WEEK = 7;
  const MIN_DAYS = WEEK;            // at least one full week of traffic
  const MAX_DAYS = 8 * WEEK;        // longer tests get muddied by cookie churn and seasonality
  const SRM_ALPHA = 0.001;
  const MIN_CONVERSIONS = 10;       // below this the normal approximation is not trustworthy
  const STEADY_CONVERSIONS = 100;   // below this one conversion visibly moves the lift
  const BISECT_STEPS = 60;
  const CHECK_FIELDS = ['visitorsA', 'conversionsA', 'visitorsB', 'conversionsB', 'days'];
  const PLAN_FIELDS = ['baseline', 'lift', 'daily'];
  const EXAMPLE = { visitorsA: '8,650', conversionsA: '260', visitorsB: '8,610', conversionsB: '297', days: '5' };

  // --- The normal distribution ---

  function normalCdf(z) {
    const x = Math.abs(z);
    let tail = 0;
    if (x < 37) {
      const e = Math.exp(-x * x / 2);
      if (x < 7.07106781186547) {
        const top = [0.0352624965998911, 0.700383064443688, 6.37396220353165, 33.912866078383, 112.079291497871, 221.213596169931, 220.206867912376];
        const bottom = [0.0883883476483184, 1.75566716318264, 16.064177579207, 86.7807322029461, 296.564248779674, 637.333633378831, 793.826512519948, 440.413735824752];
        const poly = (c) => c.reduce((acc, k) => acc * x + k, 0);
        tail = e * poly(top) / poly(bottom);
      } else {
        const fraction = x + 1 / (x + 2 / (x + 3 / (x + 4 / (x + 0.65))));
        tail = e / fraction / 2.506628274631;
      }
    }
    return z > 0 ? 1 - tail : tail;
  }

  const ACKLAM = {
    a: [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
    b: [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572, 1],
    c: [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
    d: [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416, 1]
  };
  const P_LOW = 0.02425;

  function normalQuantile(p) {
    const poly = (k, t) => k.reduce((acc, v) => acc * t + v, 0);
    let x;
    if (p < P_LOW || p > 1 - P_LOW) {
      const q = Math.sqrt(-2 * Math.log(p < P_LOW ? p : 1 - p));
      x = poly(ACKLAM.c, q) / poly(ACKLAM.d, q);
      if (p > 1 - P_LOW) x = -x;
    } else {
      const q = p - 0.5;
      const r = q * q;
      x = q * poly(ACKLAM.a, r) / poly(ACKLAM.b, r);
    }
    const u = (normalCdf(x) - p) * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  const twoSidedZ = (confidence) => normalQuantile(1 - (1 - confidence) / 2);

  // --- Tests on two proportions ---

  function zTest(nA, cA, nB, cB) {
    const pA = cA / nA;
    const pB = cB / nB;
    const pooled = (cA + cB) / (nA + nB);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
    const z = se > 0 ? (pB - pA) / se : 0;
    return { pA, pB, z, pValue: 2 * normalCdf(-Math.abs(z)) };
  }

  function liftRange(nA, cA, nB, cB, confidence) {
    if (cA === 0 || cB === 0) return { lift: null, low: null, high: null };
    const logRatio = Math.log((cB / nB) / (cA / nA));
    const se = Math.sqrt(1 / cB - 1 / nB + 1 / cA - 1 / nA);
    const z = twoSidedZ(confidence);
    return { lift: Math.exp(logRatio) - 1, low: Math.exp(logRatio - z * se) - 1, high: Math.exp(logRatio + z * se) - 1 };
  }

  // Visitors per variant for a two-sided test at `confidence` with `power` (not rounded).
  function sampleSize(p1, p2, { confidence, power: wanted }) {
    if (p1 === p2) return Infinity;
    const mean = (p1 + p2) / 2;
    const a = twoSidedZ(confidence) * Math.sqrt(2 * mean * (1 - mean));
    const b = normalQuantile(wanted) * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
    return ((a + b) / (p2 - p1)) ** 2;
  }

  function power(n, p1, p2, confidence) {
    const mean = (p1 + p2) / 2;
    const signal = Math.sqrt(n) * Math.abs(p2 - p1) - twoSidedZ(confidence) * Math.sqrt(2 * mean * (1 - mean));
    return normalCdf(signal / Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)));
  }

  // The smallest relative lift `n` visitors per variant can prove at the chosen power.
  function detectableLift(p1, n, { confidence, power: wanted }) {
    let low = 0;
    let high = 1 / p1 - 1;
    for (let i = 0; i < BISECT_STEPS; i++) {
      const mid = (low + high) / 2;
      if (power(n, p1, p1 * (1 + mid), confidence) < wanted) low = mid; else high = mid;
    }
    return high;
  }

  function srmTest(nA, nB) {
    const expected = (nA + nB) / 2;
    const chi = ((nA - expected) ** 2 + (nB - expected) ** 2) / expected;
    const pValue = 2 * normalCdf(-Math.sqrt(chi));
    return { pValue, shareA: nA / (nA + nB), mismatch: pValue < SRM_ALPHA };
  }

  // --- Reading what people type ---

  function parseCount(raw) {
    const text = String(raw ?? '').replace(/[,\s]/g, '');
    if (text === '') return { error: 'notANumber' };
    const value = Number(text);
    if (!Number.isFinite(value)) return { error: 'notANumber' };
    if (value < 0) return { error: 'negative' };
    if (!Number.isInteger(value)) return { error: 'notWhole' };
    return { value };
  }

  function parseDecimal(raw) {
    const text = String(raw ?? '').trim().replace(',', '.');
    const value = text === '' ? NaN : Number(text);
    return Number.isFinite(value) ? { value } : { error: 'notANumber' };
  }

  function collect(fields, parse, raw, rules) {
    const values = {};
    const errors = {};
    for (const name of fields) {
      const { value, error } = parse(name, raw[name]);
      const ruled = error || (rules[name] && rules[name](value));
      if (ruled) errors[name] = ruled; else values[name] = value;
    }
    return { values, errors };
  }

  function readCheck(raw) {
    const rules = { visitorsA: (v) => v < 1 && 'needVisitors', visitorsB: (v) => v < 1 && 'needVisitors', days: (v) => v < 1 && 'needDays' };
    const out = collect(CHECK_FIELDS, (name, r) => parseCount(r), raw, rules);
    for (const side of ['A', 'B']) {
      const n = out.values[`visitors${side}`];
      const c = out.values[`conversions${side}`];
      if (n !== undefined && c !== undefined && c > n) {
        out.errors[`conversions${side}`] = 'moreThanVisitors';
        delete out.values[`conversions${side}`];
      }
    }
    return out;
  }

  function readPlan(raw) {
    const parse = (name, r) => (name === 'daily' ? parseCount(r) : parseDecimal(r));
    const rules = {
      baseline: (v) => (v <= 0 || v >= PERCENT) && 'needRate',
      lift: (v) => v <= 0 && 'needLift',
      daily: (v) => v < 1 && 'needVisitors'
    };
    const out = collect(PLAN_FIELDS, parse, raw, rules);
    const { baseline, lift } = out.values;
    if (baseline !== undefined && lift !== undefined && baseline * (1 + lift / PERCENT) >= PERCENT) {
      out.errors.lift = 'overHundred';
      delete out.values.lift;
    }
    return out;
  }

  // --- Words ---

  const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const plural = (n, word) => `${int.format(n)} ${word}${n === 1 ? '' : 's'}`;
  const pct = (x) => `${Math.round(x * PERCENT)}%`;
  const signed = (x, f) => `${x < 0 ? '−' : '+'}${f(Math.abs(x))}`;
  const pctOne = (x) => signed(x, (v) => `${(v * PERCENT).toFixed(1)}%`);
  const roughly = (n) => int.format(n >= 10000 ? Math.round(n / 100) * 100 : n >= 1000 ? Math.round(n / 10) * 10 : Math.ceil(n));
  const roundUpWeek = (days) => Math.ceil(days / WEEK) * WEEK;
  const confidenceText = (c) => (c > 0.999 ? 'over 99.9%' : `${Math.floor(c * 1000) / 10}%`);

  // --- Check my test ---

  function pace(v, multiplier) {
    const perVariantDaily = ((v.visitorsA + v.visitorsB) / 2 / v.days) * multiplier;
    const traffic = multiplier === 1 ? 'at your current traffic'
      : `at ${int.format(Math.round(perVariantDaily * 2))} visitors a day`;
    return { perVariantDaily, traffic };
  }

  function timeline(v, needed, multiplier) {
    const { perVariantDaily, traffic } = pace(v, multiplier);
    const remaining = Math.max(0, needed - Math.min(v.visitorsA, v.visitorsB));
    const sampleDays = Number.isFinite(remaining) ? Math.ceil(remaining / perVariantDaily) : Infinity;
    const daysLeft = Math.max(sampleDays, MIN_DAYS - v.days, 0);
    return { daysLeft, sampleReached: remaining === 0, reachable: v.days + daysLeft <= MAX_DAYS, traffic };
  }

  function leaderOf(pA, pB) {
    if (pA === pB) return { leader: null, lead: 0 };
    return pB > pA ? { leader: 'B', other: 'A', lead: pB / pA - 1 } : { leader: 'A', other: 'B', lead: pA / pB - 1 };
  }

  function oneConversionSwing(v, lift) {
    const side = v.conversionsB < v.conversionsA ? 'B' : 'A';
    const plusOne = side === 'A'
      ? (v.conversionsB / v.visitorsB) / ((v.conversionsA + 1) / v.visitorsA) - 1
      : ((v.conversionsB + 1) / v.visitorsB) / (v.conversionsA / v.visitorsA) - 1;
    return { side, conversions: v[`conversions${side}`], points: Math.abs(plusOne - lift) * PERCENT };
  }

  const CHECK_TEXT = {
    srm: (d) => `The split is ${pct(d.shareA)} / ${pct(1 - d.shareA)}, not 50/50, and the odds of that by chance are under 1 in 1,000. Something sends visitors unevenly (a redirect, a cache, bots), so the test is broken.`,
    tooFew: (d) => `${d.side} has only ${plural(d.conversions, 'conversion')}. Under ${MIN_CONVERSIONS} the maths isn’t reliable: a couple of orders swing everything.`,
    peeking: () => 'It looks significant, but you haven’t reached the visitors you need yet. Stopping the moment it turns green is called peeking, and it makes false wins far more likely. Run it to the planned end.',
    short: (d) => `Only ${plural(d.days, 'day')} in. Run at least a full week so weekdays and weekends both count.`,
    partialWeek: (d) => `${plural(d.days, 'day')} isn’t a whole number of weeks, so some weekdays count more than others. Stop on day ${d.weekEnd}.`,
    smallNumbers: (d) => `With ${int.format(d.conversions)} conversions in ${d.side}, one more or one less moves the lift by about ${Math.round(d.points)} points.`,
    tooSmall: (d) => `A difference this small needs about ${roughly(d.needed)} visitors per version, more than ${MAX_DAYS / WEEK} weeks at this traffic. Tests that long get muddied by returning visitors and seasonality.`
  };

  function findChecks(v, s) {
    const fewest = Math.min(v.conversionsA, v.conversionsB);
    const swing = s.lift === null ? null : oneConversionSwing(v, s.lift);
    const found = [
      s.srm.mismatch && ['fix', 'srm', { shareA: s.srm.shareA }],
      fewest < MIN_CONVERSIONS && ['fix', 'tooFew', { side: v.conversionsB < v.conversionsA ? 'B' : 'A', conversions: fewest }],
      s.significant && s.daysLeft > 0 && ['fix', 'peeking', {}],
      v.days < MIN_DAYS && ['fix', 'short', { days: v.days }],
      v.days >= MIN_DAYS && v.days % WEEK !== 0 && ['look', 'partialWeek', { days: v.days, weekEnd: roundUpWeek(v.days) }],
      swing && fewest >= MIN_CONVERSIONS && fewest < STEADY_CONVERSIONS && ['look', 'smallNumbers', swing],
      s.leader && !s.significant && !s.reachable && ['look', 'tooSmall', { needed: s.neededPerVariant }]
    ].filter(Boolean);
    return found.map(([level, code, data]) => ({ level, code, text: CHECK_TEXT[code](data) }));
  }

  function pickVerdict(v, s, blocked) {
    if (s.srm.mismatch) return 'broken';
    if (v.conversionsA === 0 || v.conversionsB === 0) return 'noData';
    if (s.significant) return blocked ? 'early' : 'win';
    return s.leader && s.reachable ? 'keepGoing' : 'tie';
  }

  const SURE = { win: 'sure', early: 'fairly sure' };
  const TIE = 'Call it a tie: even a big test would not show a difference this small at your traffic.';

  function sentenceFor(verdict, v, s) {
    const more = `Keep it running about ${plural(s.daysLeft, 'day').replace(/day/, 'more day')} ${s.traffic}.`;
    const ahead = s.leader && `${s.leader} converts ${pct(s.lead)} better than ${s.other}`;
    switch (verdict) {
      case 'broken': return `Don’t trust this test: ${s.srm.shareA > 0.5 ? 'A' : 'B'} got ${pct(Math.max(s.srm.shareA, 1 - s.srm.shareA))} of the visitors instead of half, so the split is broken. Fix it and start again.`;
      case 'noData': return `Not enough data yet: ${v.conversionsA === 0 && v.conversionsB === 0 ? 'A and B have' : `${v.conversionsA === 0 ? 'A' : 'B'} has`} no conversions, so there is nothing to compare. Keep the test running.`;
      case 'win': return `${ahead}, and you can be sure. Stop the test: ${s.leader === 'B' ? 'B won' : 'keep A'}.`;
      case 'early': return `${ahead}, and you can be fairly sure, but it’s too early to call. ${more}`;
      case 'keepGoing': return `${ahead} so far, but you can’t be sure yet. ${more}`;
      default: return s.leader ? `${s.leader} is only ${pct(s.lead)} ahead and you can’t be sure. ${TIE}` : `A and B convert exactly the same so far. ${TIE}`;
    }
  }

  function checkTest(v, options) {
    const { confidence, power: wanted, multiplier } = options;
    const test = zTest(v.visitorsA, v.conversionsA, v.visitorsB, v.conversionsB);
    const range = liftRange(v.visitorsA, v.conversionsA, v.visitorsB, v.conversionsB, confidence);
    const needed = Math.ceil(sampleSize(test.pA, test.pB, { confidence, power: wanted }));
    const s = {
      ...test, ...range, ...leaderOf(test.pA, test.pB), ...timeline(v, needed, multiplier),
      confidence: 1 - test.pValue, significant: test.pValue < 1 - confidence,
      neededPerVariant: needed, srm: srmTest(v.visitorsA, v.visitorsB)
    };
    const checks = findChecks(v, s).sort((x, y) => (x.level === y.level ? 0 : x.level === 'fix' ? -1 : 1));
    const verdict = pickVerdict(v, s, checks.some((c) => c.level === 'fix'));
    return { ...s, values: v, checks, verdict, sure: SURE[verdict] || 'not sure yet', sentence: sentenceFor(verdict, v, s) };
  }

  // --- Plan a test ---

  function planTest(v, options) {
    const p1 = v.baseline / PERCENT;
    const perVariant = Math.ceil(sampleSize(p1, p1 * (1 + v.lift / PERCENT), options));
    const days = Math.ceil(perVariant / (v.daily / 2));
    const weeks = Math.ceil(Math.max(days, MIN_DAYS) / WEEK);
    const tooLong = days > MAX_DAYS;
    const detectable = detectableLift(p1, (v.daily / 2) * MAX_DAYS, options);
    const lift = `+${oneDecimal.format(v.lift)}%`;
    const traffic = `${int.format(v.daily)} visitors a day`;
    const sentence = tooLong
      ? `At ${traffic} a ${lift} lift would take about ${plural(weeks, 'week')} to prove, too long for a fair test. In ${MAX_DAYS / WEEK} weeks this traffic can prove a lift of about +${Math.ceil(detectable * PERCENT)}% or more.`
      : `You need about ${roughly(perVariant)} visitors per version (${roughly(perVariant * 2)} in total). At ${traffic} that’s ${plural(days, 'day')}, so plan for ${plural(weeks, 'full week')}.`;
    const checks = tooLong ? [{ level: 'fix', code: 'tooLong', text: `A test this long gets muddied by returning visitors, cookie loss and seasonality. Test a bolder change, or one with more traffic.` }] : [];
    return { perVariant, total: perVariant * 2, days, weeks, tooLong, detectable, sentence, checks };
  }

  // --- Copy summary (plain text for Slack) ---

  const settingsLine = (title, o) => `${title} (${pct(o.confidence)} confidence, ${pct(o.power)} power)`;
  const checkLines = (checks) => (checks.length
    ? ['', 'Checks:', ...checks.map((c) => `- ${c.level === 'fix' ? 'Don’t trust yet' : 'Worth a look'}: ${c.text}`)]
    : ['', 'Checks: nothing to flag.']);

  function checkSummary(r, options) {
    const v = r.values;
    const side = (s, n, c) => `${s}: ${int.format(n)} visitors, ${int.format(c)} conversions (${(c / n * PERCENT).toFixed(2)}%)`;
    const lift = r.lift === null ? 'Lift: not enough data'
      : `Lift: ${pctOne(r.lift)} (range ${pctOne(r.low)} to ${pctOne(r.high)})`;
    const days = r.daysLeft === 0 ? 'none' : Number.isFinite(r.daysLeft) ? int.format(r.daysLeft) : `more than ${MAX_DAYS / WEEK} weeks`;
    const needed = Number.isFinite(r.neededPerVariant) ? `${int.format(r.neededPerVariant)} visitors per version` : 'no finite sample';
    return [settingsLine('A/B test check', options), r.sentence, '',
      side('A', v.visitorsA, v.conversionsA), side('B', v.visitorsB, v.conversionsB), lift,
      `Confidence: ${confidenceText(r.confidence)}`, `Needed: ${needed} · Days left: ${days}`,
      ...checkLines(r.checks)].join('\n');
  }

  function planSummary(p, v, options) {
    return [settingsLine('A/B test plan', options), p.sentence, '',
      `Now converting: ${oneDecimal.format(v.baseline)}%`, `Smallest lift that matters: +${oneDecimal.format(v.lift)}%`,
      `Daily visitors: ${int.format(v.daily)}`, `Visitors per version: ${int.format(p.perVariant)}`,
      `Days: ${int.format(p.days)} (plan for ${plural(p.weeks, 'full week')})`, ...checkLines(p.checks)].join('\n');
  }

  return {
    CHECK_FIELDS, PLAN_FIELDS, EXAMPLE, MAX_DAYS, MIN_DAYS,
    normalCdf, normalQuantile, zTest, liftRange, sampleSize, power, detectableLift, srmTest,
    readCheck, readPlan, checkTest, planTest, checkSummary, planSummary, confidenceText, roundUpWeek
  };
});
