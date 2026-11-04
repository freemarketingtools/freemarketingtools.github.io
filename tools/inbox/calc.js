// Where four inboxes cut an email's sender, subject and preheader, by rendered pixel width, and the
// mistakes that don't error. Runs in the browser (inlined by scripts/build.mjs, exposed as
// window.InboxCalc) and in Node (tests). Every measuring function takes `measure(text, font) -> px`:
// the page passes canvas measureText, the tests pass a fake, so the maths is tested without a browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InboxCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ESTIMATES. No mail client publishes its inbox widths, and they change with the device, the window,
  // the density setting and app updates. Each figure below is the row's text column on the named screen,
  // worked out from the platform's own type scale and the row's measured layout (avatar, gutters, date):
  // - Gmail (Android/iOS app and web) sets its lists in Google Sans / Roboto at the Material 3 body sizes
  //   (14px body, 16px for the sender line): https://m3.material.io/styles/typography/type-scale-tokens
  //   Phone, 393 px wide: 16px gutters, 40px avatar, date beside the sender, star beside the preview.
  //   Desktop, a 1440 px window at default density with the menu open: a ~168px sender column and one
  //   shared line of ~760px for the subject, " - " and the preview. Density: https://support.google.com/mail/answer/9259769
  // - Apple Mail on iPhone uses the system font (SF Pro) at the iOS text styles: Headline 17pt semibold for
  //   the sender, Subheadline 15pt for the subject and preview: https://developer.apple.com/design/human-interface-guidelines/typography
  //   2 preview lines is Apple's default (Settings > Apps > Mail > Preview): https://support.apple.com/guide/iphone/iph461684497/ios
  //   iPhone 15, 393 pt wide,
  //   classic list with contact photos off: a 36pt unread-dot gutter and a 16pt right margin.
  // - Outlook (new Outlook for Windows and Outlook on the web) uses Segoe UI at the Fluent 2 sizes (14px
  //   body, 13px caption-ish preview): https://fluent2.microsoft.design/typography. A 1440 px window with
  //   the reading pane on the right leaves a ~360px message list; the time sits beside the subject. Preview
  //   lines are now a setting (Microsoft 365 roadmap 564610); 1 line is assumed.
  // Character-count tables (Gmail ~90-97, iPhone ~81-90, Outlook 35-255 characters) agree only roughly,
  // which is why this tool measures pixels instead: https://newsletter2go-en.helpscoutdocs.com/article/1721-how-to-use-preview-text
  const GMAIL = '"Google Sans", Roboto, Arial, sans-serif';
  const APPLE = '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
  const OUTLOOK = '"Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
  const CLIENTS = [
    { id: 'gmailPhone', name: 'Gmail on a phone', screen: 'Phone, 393 px wide',
      sender: { font: `700 16px ${GMAIL}`, width: 249 }, subject: { font: `700 14px ${GMAIL}`, width: 305 },
      preview: { font: `400 14px ${GMAIL}`, width: 273, lines: 1 } },
    { id: 'iphoneMail', name: 'Apple Mail on an iPhone', screen: 'iPhone, 393 pt wide, 2 preview lines',
      sender: { font: `600 17px ${APPLE}`, width: 271 }, subject: { font: `400 15px ${APPLE}`, width: 341 },
      preview: { font: `400 15px ${APPLE}`, width: 341, lines: 2 } },
    { id: 'outlookDesktop', name: 'Outlook on desktop', screen: '1440 px window, reading pane on the right',
      sender: { font: `600 14px ${OUTLOOK}`, width: 300 }, subject: { font: `600 14px ${OUTLOOK}`, width: 236 },
      preview: { font: `400 13px ${OUTLOOK}`, width: 300, lines: 1 } },
    { id: 'gmailDesktop', name: 'Gmail on desktop', screen: '1440 px window, menu open',
      sender: { font: `700 14px ${GMAIL}`, width: 168 }, subject: { font: `700 14px ${GMAIL}`, width: 760 },
      preview: { font: `400 14px ${GMAIL}`, width: 760, lines: 1, shared: true } }
  ];
  const EVERY_INBOX = 'Every inbox';
  const ELLIPSIS = '…';
  const SEPARATOR = ' - ';
  const FALLBACK_PREVIEW = 'View this email in your browser';
  const SHORT_SHARE = 0.6; // a preheader under 60% of the line leaves room the inbox fills with body text
  const REPEAT_SHARE = 0.8;
  const REPEAT_MIN_WORDS = 3;
  const CAPS_WORD = 4;
  const CAPS_WORDS = 2;
  const CAPS_SHARE = 0.6;
  const CAPS_MIN_LETTERS = 8;
  const EMOJI_MAX = 2;
  const BANGS_MAX = 2;
  // A guide, not a rule: phrases spam filters and readers have long treated as pushy. Filters weigh the
  // sender's reputation and engagement far more than any one word.
  const SPAM_PHRASES = ['act now', 'apply now', 'buy now', 'order now', 'click here', 'click below', 'limited time',
    'urgent', 'winner', 'you have been selected', 'you’ve been selected', 'congratulations', 'guaranteed', '100% free',
    'risk-free', 'risk free', 'no obligation', 'no cost', 'free money', 'cash bonus', 'earn money', 'make money',
    'double your', 'extra cash', 'miracle', 'lowest price', 'this is not spam', 'dear friend', 'once in a lifetime'];
  // The key offer is the first match of the earliest pattern in this list: a discount beats a plain number.
  const OFFER_PATTERNS = [/\d[\d.,]*\s?%(?:\s?off)?/i, /[$€£]\s?\d[\d.,]*(?:\s?off)?/i, /\d[\d.,]*\s?(?:off|dollars|euros)\b/i,
    /\bfree\s+(?:shipping|delivery|returns|gift)\b/i, /\bbogo\b|\bbuy one,? get one\b/i, /\bhalf[- ]price\b/i, /\bfree\b/i, /\d[\d.,]*/];
  const EXAMPLE = {
    sender: 'Northpeak Outfitters',
    subject: 'Final hours of our Winter Sale, so don’t wait any longer: 40% off every jacket',
    preheader: 'Ends at midnight. Free shipping over $50 and free 60-day returns.'
  };

  const segmenter = new Intl.Segmenter();
  const graphemes = (text) => [...segmenter.segment(text)].map((s) => s.segment);
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const count = (text) => graphemes(clean(text)).length;
  const words = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  // Largest n in [0, max] where fits(n) holds, assuming fits is true up to some n and false after.
  function largestFitting(max, fits) {
    let lo = 0;
    let hi = max;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // One line as an inbox shows it within `width` px. Inboxes cut mid-word (CSS text-overflow, iOS tail
  // truncation, Android ellipsize), so this cuts by character and puts "…" right after the last one that
  // fits. `hidden` starts at the word that got cut, so it reads naturally; `cutIndex` is where the visible
  // text ends in the cleaned input.
  function fitLine(text, font, width, measure) {
    const full = clean(text);
    if (!full || measure(full, font) <= width) {
      return { lines: [full], text: full, visible: full, hidden: '', cut: false, cutIndex: full.length };
    }
    const chars = graphemes(full);
    const prefix = (n) => chars.slice(0, n).join('').trimEnd();
    const visible = prefix(largestFitting(chars.length, (n) => measure(prefix(n) + ELLIPSIS, font) <= width));
    const cutIndex = visible.length;
    const midWord = cutIndex > 0 && full[cutIndex] !== ' ';
    const hidden = full.slice(midWord ? full.lastIndexOf(' ', cutIndex - 1) + 1 : cutIndex).trim();
    return { lines: [visible + ELLIPSIS], text: visible + ELLIPSIS, visible, hidden, cut: true, cutIndex };
  }

  // The longest start of `text` that fits one full line: whole words, or characters if one word is too wide.
  function firstLine(text, font, width, measure) {
    const parts = text.split(' ');
    const n = largestFitting(parts.length, (k) => measure(parts.slice(0, k).join(' '), font) <= width);
    if (n > 0) return parts.slice(0, n).join(' ');
    const chars = graphemes(text);
    return chars.slice(0, Math.max(1, largestFitting(chars.length, (k) => measure(chars.slice(0, k).join(''), font) <= width))).join('');
  }

  // Several lines (Apple Mail's 2-line preview): words wrap, and only the last line is cut.
  function fitLines(text, font, width, lines, measure) {
    let rest = clean(text);
    let offset = 0;
    const done = [];
    while (done.length < lines - 1 && measure(rest, font) > width) {
      const line = firstLine(rest, font, width, measure);
      done.push(line);
      offset += line.length + (rest[line.length] === ' ' ? 1 : 0);
      rest = rest.slice(line.length).trimStart();
    }
    const last = fitLine(rest, font, width, measure);
    const head = done.length ? `${done.join(' ')} ` : '';
    return { ...last, lines: [...done, last.text].filter((l, n) => l || n === 0), text: head + last.text,
      visible: head + last.visible, cutIndex: offset + last.cutIndex };
  }

  function keyOffer(subject) {
    for (const pattern of OFFER_PATTERNS) {
      const match = pattern.exec(subject);
      if (match) return { text: match[0].trim(), index: match.index };
    }
    return null;
  }

  // Gmail desktop puts subject, " - " and preview on one line: the preview gets what the subject leaves.
  function sharedPreview(spec, subjectFit, preview, measure) {
    if (subjectFit.cut) return { lines: [''], text: '', visible: '', hidden: preview, cut: true, cutIndex: 0, room: 0, crowded: true };
    const room = spec.subject.width - measure(subjectFit.text, spec.subject.font) - measure(SEPARATOR, spec.preview.font);
    return { ...fitLine(preview, spec.preview.font, room, measure), room };
  }

  function fitClient(spec, input, measure) {
    const subject = fitLine(input.subject, spec.subject.font, spec.subject.width, measure);
    const previewText = input.preheader || FALLBACK_PREVIEW;
    const preview = spec.preview.shared ? sharedPreview(spec, subject, previewText, measure)
      : fitLines(previewText, spec.preview.font, spec.preview.width, spec.preview.lines, measure);
    preview.source = input.preheader ? 'preheader' : 'fallback';
    const sender = fitLine(input.sender, spec.sender.font, spec.sender.width, measure);
    return { id: spec.id, name: spec.name, screen: spec.screen, spec, sender, subject, preview };
  }

  const issue = (code, level, text) => ({ code, level, text });
  // "Hidden: “…”." without a second full stop when the hidden words already end a sentence.
  const hiddenSentence = (hidden) => `Hidden: “${hidden}”${/[.!?]$/.test(hidden) ? '' : '.'}`;

  // The checks that differ per inbox: what this inbox's width hides.
  function clientIssues(c, offer, hasPreheader) {
    const issues = [];
    const stops = `Your subject stops at “${c.subject.visible}${ELLIPSIS}”`;
    if (c.subject.cut && offer && offer.index + offer.text.length > c.subject.cutIndex) {
      issues.push(issue('offerCut', 'fix', `${stops}, so “${offer.text}” is hidden.`));
    } else if (c.subject.cut) issues.push(issue('subjectCut', 'look', `${stops}. ${hiddenSentence(c.subject.hidden)}`));
    if (hasPreheader && c.preview.crowded) {
      issues.push(issue('previewCrowdedOut', 'look', 'The subject fills the whole line, so your preheader doesn’t show at all.'));
    } else if (hasPreheader && c.preview.cut) {
      issues.push(issue('previewCut', 'look', `Your preheader stops at “${c.preview.visible}${ELLIPSIS}”. ${hiddenSentence(c.preview.hidden)}`));
    }
    if (c.sender.cut) issues.push(issue('senderCut', 'look', `Your sender name stops at “${c.sender.visible}${ELLIPSIS}”.`));
    return issues;
  }

  function repeatsSubject(subject, preheader) {
    const s = words(subject).join(' ');
    const p = words(preheader);
    if (!s || !p.length) return false;
    const inSubject = new Set(words(subject));
    const shared = p.filter((w) => inSubject.has(w)).length;
    return p.join(' ').startsWith(s) || s.startsWith(p.join(' ')) || (p.length >= REPEAT_MIN_WORDS && shared / p.length >= REPEAT_SHARE);
  }

  function isShort(preheader, measure) {
    return CLIENTS.filter((c) => !c.preview.shared)
      .every((c) => measure(preheader, c.preview.font) < SHORT_SHARE * c.preview.width * c.preview.lines);
  }

  function capsWords(subject) {
    const all = subject.match(/\p{L}+/gu) || [];
    const caps = all.filter((w) => w.length >= CAPS_WORD && w === w.toUpperCase() && w !== w.toLowerCase());
    const letters = all.join('');
    const upper = [...letters].filter((ch) => ch !== ch.toLowerCase()).length;
    return caps.length >= CAPS_WORDS || (letters.length >= CAPS_MIN_LETTERS && upper / letters.length > CAPS_SHARE) ? caps : null;
  }

  const emojiCount = (text) => graphemes(text).filter((g) => /\p{Extended_Pictographic}/u.test(g)).length;
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function spamPhrases(text) {
    const lower = text.toLowerCase();
    return SPAM_PHRASES.map((p) => ({ p, at: lower.search(new RegExp(`(^|[^\\p{L}\\p{N}])${escape(p)}($|[^\\p{L}\\p{N}])`, 'u')) }))
      .filter((m) => m.at >= 0).sort((a, b) => a.at - b.at).map((m) => m.p);
  }

  const quoteList = (items) => items.map((t) => `“${t}”`).join(', ');

  function preheaderIssues(input, measure) {
    if (!input.preheader) {
      return [issue('previewEmpty', 'fix', `No preheader. Every inbox shows the first line of your email instead, often “${FALLBACK_PREVIEW}”.`)];
    }
    if (repeatsSubject(input.subject, input.preheader)) {
      return [issue('previewRepeats', 'fix', 'Your preheader repeats the subject, so the preview line adds nothing. Use it for the next reason to open.')];
    }
    return isShort(input.preheader, measure)
      ? [issue('previewShort', 'look', 'Your preheader is short. Inboxes fill the rest of the line with the first words of your email.')] : [];
  }

  function toneIssues(input) {
    const issues = [];
    const caps = capsWords(input.subject);
    if (caps) issues.push(issue('allCaps', 'look', `ALL CAPS reads as shouting and is a common spam signal${caps.length ? `: ${quoteList(caps)}` : ''}.`));
    const bangs = /[!?]{2,}/.exec(input.subject);
    if (bangs || (input.subject.match(/!/g) || []).length > BANGS_MAX) {
      issues.push(issue('punctuation', 'look', `${bangs ? `“${bangs[0]}”` : 'Several “!”'} reads as spam. One “!” at most.`));
    }
    const emoji = emojiCount(input.subject);
    if (emoji > EMOJI_MAX) issues.push(issue('emoji', 'look', `${emoji} emoji in the subject. More than ${EMOJI_MAX} reads as spam, and some inboxes show them as empty boxes.`));
    const spam = spamPhrases(`${input.subject}\n${input.preheader}`);
    if (spam.length) {
      issues.push(issue('spamWords', 'look', `Words spam filters watch for: ${quoteList(spam)}. A guide, not a rule: filters judge your sending history far more.`));
    }
    return issues;
  }

  // The checks that hold in every inbox at once.
  function globalIssues(input, measure) {
    const issues = [];
    if (!input.subject) issues.push(issue('subjectEmpty', 'fix', 'No subject line. Most inboxes show “(no subject)”, which reads as spam.'));
    if (!input.sender) issues.push(issue('senderEmpty', 'look', 'No sender name. Inboxes show your email address instead.'));
    return [...issues, ...preheaderIssues(input, measure), ...(input.subject ? toneIssues(input) : [])];
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function verdict(clients, issues) {
    const all = [...issues, ...clients.flatMap((c) => c.issues)];
    const has = (code) => all.some((i) => i.code === code);
    const inboxes = (code) => clients.filter((c) => c.issues.some((i) => i.code === code)).length;
    const fix = all.filter((i) => i.level === 'fix').length;
    const look = all.length - fix;
    const sub = [fix ? `${fix} to fix` : '', look ? `${look} worth a look` : ''].filter(Boolean).join(' · ');
    const of = (n) => `${n} of ${clients.length} inboxes`;
    if (has('subjectEmpty')) return { level: 'fix', headline: 'Add a subject line', sub, fix, look };
    if (has('offerCut')) return { level: 'fix', headline: `Your offer is cut off in ${of(inboxes('offerCut'))}`, sub, fix, look };
    if (has('previewEmpty')) return { level: 'fix', headline: 'Your preview text is missing in every inbox', sub, fix, look };
    if (has('previewRepeats')) return { level: 'fix', headline: 'Your preview text repeats the subject', sub, fix, look };
    if (has('subjectCut')) return { level: fix ? 'fix' : 'look', headline: `Your subject is cut off in ${of(inboxes('subjectCut'))}`, sub, fix, look };
    if (all.length) return { level: fix ? 'fix' : 'look', headline: 'Your subject fits every inbox', sub, fix, look };
    return { level: 'ok', headline: 'Fits every inbox in full', sub: '', fix, look };
  }

  // { sender, subject, preheader } -> per-inbox fits and issues, the issues for every inbox, and a verdict.
  function inboxPreview(raw, measure) {
    const input = { sender: clean(raw.sender), subject: clean(raw.subject), preheader: clean(raw.preheader) };
    const offer = keyOffer(input.subject);
    const clients = CLIENTS.map((spec) => {
      const c = fitClient(spec, input, measure);
      return { ...c, issues: clientIssues(c, offer, Boolean(input.preheader)) };
    });
    const issues = globalIssues(input, measure);
    return { input, offer, clients, issues, verdict: verdict(clients, issues) };
  }

  const LEVEL_NAMES = { fix: 'to fix', look: 'worth a look' };

  function problemList(result) {
    const line = (where, i) => `${where} (${LEVEL_NAMES[i.level]}): ${i.text}`;
    const lines = [...result.clients.flatMap((c) => c.issues.map((i) => line(c.name, i))), ...result.issues.map((i) => line(EVERY_INBOX, i))];
    return [result.verdict.headline, '', ...lines].join('\n');
  }

  return { CLIENTS, ELLIPSIS, SEPARATOR, FALLBACK_PREVIEW, EVERY_INBOX, EXAMPLE, LEVEL_NAMES, plural,
    count, fitLine, fitLines, keyOffer, inboxPreview, problemList };
});
