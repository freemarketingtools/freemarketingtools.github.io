// GA4 event name checks: what GA4 rejects or drops, what quietly splits reports, and the fix.
// Runs in the browser (inlined by scripts/build.mjs, exposed as window.Ga4Calc) and in Node (tests).
//
// Where the rules come from (Google's own pages, read 2026-11-03):
// - Event naming rules, reserved names and prefixes: support.google.com/analytics/answer/13316687
//   (start with a letter; letters, numbers and underscores only; case-sensitive; non-English letters
//   allowed; separate reserved lists for web and app streams; parameter prefixes _ firebase_ ga_
//   google_ gtag.).
// - Measurement Protocol reserved names: developers.google.com/analytics/devguides/collection/protocol/
//   ga4/reference (reserved event names; ad_impression, in_app_purchase and screen_view are for app
//   streams only; parameter prefixes; 25 parameters per event; names of 40 characters or fewer).
// - Collection limits: support.google.com/analytics/answer/9267744 (40-character event and parameter
//   names, 25 parameters per event; anything over a limit isn't logged).
// - App SDK naming: firebase.google.com/docs/reference/android/com/google/firebase/analytics/
//   FirebaseAnalytics.Event and .Param (the firebase_, google_ and ga_ event prefixes; invalid events
//   are dropped and an error event is logged instead).
// - Recommended events: support.google.com/analytics/answer/9267735.
// Estimates and stream differences, labelled the same way on the page:
// - ESTIMATE: Google states the google_ / ga_ / firebase_ EVENT prefixes for app streams only; we treat
//   them as reserved on web too.
// - WEB vs APP: app-only names are a problem on web streams only; the auto-collected web names (page_view,
//   scroll...) are listed as reserved for web, but sending them by hand works, so they're a warning.
// - ESTIMATE: near-misses come from our own list of common alternative spellings, not from Google.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ga4Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { name: 40, params: 25 };
  const VALID_START = /^\p{L}/u;
  const BAD_CHARS = /[^\p{L}\p{N}_]/gu;
  const ACCENTS = /[̀-ͯ]/g;
  const HEADER = /^(events?|event[ _-]?names?|names?)$/i;
  const EVENT_PREFIXES = ['google_', 'ga_', 'firebase_'];
  const PARAM_PREFIXES = ['_', 'firebase_', 'ga_', 'google_', 'gtag.'];
  const CHAR_NAMES = { ' ': 'a space', '-': 'a dash', '.': 'a dot', '\t': 'a tab' };

  // Reserved on every stream: GA4 sends these itself and drops a custom event with the name.
  const RESERVED = new Set(['ad_activeview', 'ad_click', 'ad_exposure', 'ad_query', 'ad_reward', 'adunit_exposure',
    'app_clear_data', 'app_exception', 'app_install', 'app_remove', 'app_store_refund', 'app_store_subscription_cancel',
    'app_store_subscription_renew', 'app_update', 'app_upgrade', 'dynamic_link_app_open', 'dynamic_link_app_update',
    'dynamic_link_first_open', 'error', 'firebase_campaign', 'firebase_in_app_message_action',
    'firebase_in_app_message_dismiss', 'firebase_in_app_message_impression', 'first_open', 'first_visit',
    'notification_dismiss', 'notification_foreground', 'notification_open', 'notification_receive',
    'notification_send', 'os_update', 'session_start', 'user_engagement']);
  // WEB vs APP: only app streams accept these.
  const APP_ONLY = new Set(['ad_impression', 'in_app_purchase', 'screen_view']);
  // WEB vs APP: collected automatically on web (enhanced measurement) and on Google's web reserved list.
  const WEB_AUTO = new Set(['page_view', 'scroll', 'click', 'file_download', 'form_start', 'form_submit',
    'video_start', 'video_progress', 'video_complete', 'view_search_results']);

  const ECOMMERCE = ['add_payment_info', 'add_shipping_info', 'add_to_cart', 'add_to_wishlist', 'begin_checkout',
    'purchase', 'refund', 'remove_from_cart', 'select_item', 'select_promotion', 'view_cart', 'view_item',
    'view_item_list', 'view_promotion'];
  const LEADS = ['generate_lead', 'qualify_lead', 'disqualify_lead', 'working_lead', 'close_convert_lead', 'close_unconvert_lead'];
  const OTHER_RECOMMENDED = ['earn_virtual_currency', 'join_group', 'login', 'search', 'select_content', 'share',
    'sign_up', 'spend_virtual_currency', 'tutorial_begin', 'tutorial_complete', 'level_end', 'level_start',
    'level_up', 'post_score', 'unlock_achievement'];
  // ESTIMATE: common alternative names and the recommended event they almost always mean.
  const ALIASES = {
    purchase: ['purchase_complete', 'purchase_completed', 'purchased', 'order_complete', 'order_completed',
      'order_placed', 'checkout_complete', 'checkout_completed', 'completed_purchase'],
    add_to_cart: ['add_cart', 'cart_add', 'added_to_cart', 'add_to_basket', 'add_to_bag', 'add_item_to_cart'],
    remove_from_cart: ['remove_cart', 'cart_remove', 'removed_from_cart', 'remove_from_basket', 'remove_from_bag'],
    begin_checkout: ['start_checkout', 'checkout_start', 'checkout_started', 'checkout_begin', 'initiate_checkout',
      'proceed_to_checkout', 'checkout'],
    view_item: ['view_product', 'product_view', 'product_viewed', 'viewed_product', 'view_content', 'item_view',
      'product_detail_view'],
    view_item_list: ['view_category', 'category_view', 'product_list_view', 'view_product_list', 'product_impressions'],
    view_cart: ['cart_view', 'viewed_cart', 'view_basket', 'view_bag'],
    add_to_wishlist: ['wishlist_add', 'added_to_wishlist', 'add_wishlist', 'add_to_favorites', 'add_to_favourites'],
    add_payment_info: ['payment_info', 'add_payment', 'add_payment_method', 'payment_info_added'],
    add_shipping_info: ['shipping_info', 'add_shipping', 'add_shipping_method'],
    select_item: ['product_click', 'select_product', 'item_click'],
    select_promotion: ['promo_click', 'promotion_click', 'select_promo'],
    view_promotion: ['promo_view', 'promotion_view', 'view_promo', 'promotion_impression'],
    refund: ['order_refund', 'refunded'],
    sign_up: ['signup', 'register', 'registration', 'complete_registration', 'create_account', 'account_created'],
    login: ['log_in', 'signin', 'sign_in'],
    generate_lead: ['lead', 'new_lead', 'submit_lead', 'lead_submit', 'lead_form_submit'],
    search: ['site_search'],
    share: ['social_share'],
    tutorial_begin: ['tutorial_start']
  };

  // The key that ignores case and separators: names that share it look like one event but count as two.
  const looseKey = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  const RECOMMENDED_BY_KEY = new Map();
  for (const name of [...ECOMMERCE, ...LEADS, ...OTHER_RECOMMENDED]) RECOMMENDED_BY_KEY.set(looseKey(name), name);
  for (const [name, aliases] of Object.entries(ALIASES)) for (const a of aliases) RECOMMENDED_BY_KEY.set(looseKey(a), name);

  function recommendedFor(name) {
    const key = looseKey(name);
    return RECOMMENDED_BY_KEY.get(key) || (key.endsWith('s') && RECOMMENDED_BY_KEY.get(key.slice(0, -1))) || null;
  }

  function lossText(recommended) {
    if (recommended === 'purchase') return 'Use that exact name: GA4 only counts revenue and ecommerce purchases from purchase.';
    if (ECOMMERCE.includes(recommended)) return 'Use that exact name: GA4’s ecommerce reports only read the recommended names, so this event stays out of them.';
    if (LEADS.includes(recommended)) return 'Use that exact name: GA4’s lead reports only read the recommended names.';
    return 'Use that exact name so GA4 fills its built-in dimensions and reports for it.';
  }

  // --- Reading the list: "name: params", or a row of comma or tab cells, or a bare column ---

  const cleanCell = (cell) => {
    const trimmed = cell.trim();
    const quoted = trimmed.match(/^"(.*)"$/);
    return quoted ? quoted[1].trim() : trimmed;
  };

  function parseLine(raw) {
    const colonAt = raw.indexOf(':');
    if (colonAt >= 0) {
      return { style: 'colon', name: cleanCell(raw.slice(0, colonAt)), params: raw.slice(colonAt + 1).split(/[,\t]/) };
    }
    const style = raw.includes('\t') ? 'tab' : 'comma';
    const cells = raw.split(style === 'tab' ? '\t' : ',');
    return { style, name: cleanCell(cells[0]), params: cells.slice(1), sep: raw.includes(', ') ? ', ' : ',' };
  }

  // A header row ("Event name, Parameters") is skipped only as the first non-blank line.
  function parseList(text) {
    const rows = [];
    let first = true;
    String(text).split(/\r?\n/).forEach((raw, index) => {
      if (raw.trim() === '') return;
      const row = { line: index + 1, raw, ...parseLine(raw) };
      row.params = row.params.map(cleanCell).filter(Boolean);
      const isHeader = first && HEADER.test(row.name);
      first = false;
      if (!isHeader) rows.push(row);
    });
    return rows;
  }

  // --- Name and parameter rules ---

  const issue = (level, code, text, extra) => ({ level, code, text, ...extra });

  function describeChars(name) {
    const found = [...new Set(name.match(BAD_CHARS))];
    return found.map((c) => CHAR_NAMES[c] || `“${c}”`).join(', ');
  }

  // The three rules events and parameters share: length, first character, allowed characters.
  function shapeIssues(name, label, extra) {
    const issues = [];
    const length = [...name].length;
    if (length > LIMITS.name) issues.push(issue('reject', 'tooLong', `${label}is ${length} characters long. GA4 doesn’t log names over ${LIMITS.name}.`, extra));
    if (!VALID_START.test(name)) issues.push(issue('reject', 'badStart', `${label}starts with “${[...name][0]}”. Names must start with a letter.`, extra));
    if (name.match(BAD_CHARS)) issues.push(issue('reject', 'badChars', `${label}has ${describeChars(name)}. Only letters, numbers and underscores are allowed.`, extra));
    return issues;
  }

  function reservedIssues(name) {
    if (RESERVED.has(name)) return [issue('reject', 'reserved', `Reserved: GA4 sends ${name} itself and drops yours. Remove this line.`)];
    if (APP_ONLY.has(name)) return [issue('reject', 'appOnly', `Only app streams accept ${name}. A web stream rejects it.`, { stream: 'web' })];
    if (WEB_AUTO.has(name)) {
      return [issue('weak', 'autoCollected', `On web, GA4 already collects ${name} itself (enhanced measurement), so sending your own can count it twice. Google lists it as reserved for web streams.`, { stream: 'web' })];
    }
    const prefix = EVENT_PREFIXES.find((p) => name.toLowerCase().startsWith(p));
    if (!prefix) return [];
    return [issue('reject', 'reservedPrefix', `Starts with ${prefix}, a prefix Google reserves. Google’s app docs say these events are dropped; on web treat it the same (estimate).`)];
  }

  function paramIssues(params) {
    const issues = params.flatMap((param) => {
      const prefix = PARAM_PREFIXES.find((p) => param.toLowerCase().startsWith(p));
      if (prefix) return [issue('reject', 'reservedPrefix', `Parameter ${param} starts with ${prefix}, which Google reserves. GA4 drops it.`, { param })];
      return shapeIssues(param, `Parameter ${param} `, { param });
    });
    const count = new Set(params).size;
    if (count > LIMITS.params) {
      issues.push(issue('reject', 'tooManyParams', `${count} parameters. GA4 keeps ${LIMITS.params} per event and ignores the other ${count - LIMITS.params}.`));
    }
    return issues;
  }

  function quietIssues(name, group) {
    const issues = [];
    const recommended = recommendedFor(name);
    if (recommended && recommended !== name) {
      issues.push(issue('weak', 'nearMiss', `Close to Google’s recommended ${recommended}. ${lossText(recommended)}`, { suggestion: recommended }));
    }
    if (group.names.length > 1 && name !== group.target) {
      const list = group.names.join(', ');
      issues.push(issue('weak', 'split', `GA4 is case-sensitive, so ${list} count as ${group.names.length} separate events. Pick one: ${group.target}.`));
    }
    return issues;
  }

  function nameIssues(name, group) {
    if (name === '') return [issue('reject', 'noName', 'No event name before the parameters.')];
    const shape = shapeIssues(name, 'The name ');
    return [...shape, ...reservedIssues(name), ...quietIssues(name, group)];
  }

  // --- Groups: every spelling that shares a loose key, and the one name they should all become ---

  function groupsOf(rows) {
    const groups = new Map();
    for (const { name } of rows) {
      const key = looseKey(name);
      if (!groups.has(key)) groups.set(key, { names: [] });
      const group = groups.get(key);
      if (!group.names.includes(name)) group.names.push(name);
    }
    for (const group of groups.values()) {
      group.target = recommendedFor(group.names[0]) || group.names.find((n) => snakeName(n) === n) || snakeName(group.names[0]);
    }
    return groups;
  }

  const worst = (issues) => (issues.some((i) => i.level === 'reject') ? 'reject' : issues.length ? 'weak' : 'ok');

  function checkRows(rows) {
    const groups = groupsOf(rows);
    const firstLine = new Map();
    return rows.map((row) => {
      const duplicateOf = firstLine.has(row.name) ? firstLine.get(row.name) : null;
      if (duplicateOf === null) firstLine.set(row.name, row.line);
      const issues = [...nameIssues(row.name, groups.get(looseKey(row.name))), ...paramIssues(row.params)];
      return { line: row.line, name: row.name, params: row.params, issues, duplicateOf };
    });
  }

  function eventsOf(lines) {
    const events = new Map();
    for (const l of lines) {
      if (!events.has(l.name)) events.set(l.name, { name: l.name, line: l.line, lines: [], issues: [] });
      const event = events.get(l.name);
      event.lines.push(l.line);
      for (const i of l.issues) if (!event.issues.some((e) => e.text === i.text)) event.issues.push(i);
    }
    return [...events.values()].map((e) => ({ ...e, level: worst(e.issues) }));
  }

  function checkList(text) {
    const lines = checkRows(parseList(text));
    const events = eventsOf(lines);
    return {
      lines,
      events,
      duplicates: events.filter((e) => e.lines.length > 1).map((e) => ({ name: e.name, lines: e.lines })),
      total: events.length,
      reject: events.filter((e) => e.level === 'reject').length,
      weak: events.filter((e) => e.level === 'weak').length
    };
  }

  // --- Verdict and the copyable problem list ---

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function verdict(result) {
    const { total, reject, weak, duplicates } = result;
    if (total === 0) return { level: 'empty', headline: 'Paste your events to check them', sub: '' };
    const dupes = duplicates.length ? plural(duplicates.length, 'duplicate line') : '';
    if (reject || weak) {
      const parts = [reject && `${reject} GA4 would reject or drop`, weak && `${weak} split or weaken reports`, dupes].filter(Boolean);
      const headline = `${reject + weak} of ${plural(total, 'event')} would break your reports`;
      return { level: reject ? 'reject' : 'weak', headline, sub: parts.join(' · ') };
    }
    if (dupes) return { level: 'weak', headline: 'No event would break your reports', sub: `${dupes} to tidy up.` };
    const headline = total === 1 ? 'Your 1 event follows GA4’s rules' : `All ${total} events follow GA4’s rules`;
    return { level: 'ok', headline, sub: 'Nothing GA4 would reject, drop or split.' };
  }

  const LEVEL_WORDS = { reject: 'GA4 rejects', weak: 'weakens reports' };
  const joinLines = (lines) => (lines.length === 2 ? lines.join(' and ') : `${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}`);

  function duplicateText(lines) {
    return `Listed ${lines.length} times (lines ${joinLines(lines)}). It counts once; Fix names merges the lines.`;
  }

  function problemList(result) {
    const lines = result.events.flatMap((e) => e.issues.map((i) => `Line ${e.line}, ${e.name} (${LEVEL_WORDS[i.level]}): ${i.text}`));
    for (const d of result.duplicates) lines.push(`Line ${d.lines[1]}, ${d.name} (duplicate): ${duplicateText(d.lines)}`);
    return [verdict(result).headline, '', ...lines].join('\n');
  }

  // --- Fix names ---

  function cutAtUnderscore(name) {
    if (name.length <= LIMITS.name) return name;
    const cut = name.slice(0, LIMITS.name);
    const at = cut.lastIndexOf('_');
    return at > 0 ? cut.slice(0, at) : cut;
  }

  // Any spelling as valid snake_case: camelCase split, accents dropped, reserved prefixes removed.
  function snakeName(name, fallback = 'event') {
    let s = String(name).normalize('NFD').replace(ACCENTS, '')
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1_$2').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+/, '');
    while (EVENT_PREFIXES.some((p) => s.startsWith(p))) s = s.slice(s.indexOf('_') + 1);
    s = s.replace(/^_+|_+$/g, '');
    if (s === '') return fallback;
    if (!VALID_START.test(s)) s = `${fallback}_${s}`;
    return cutAtUnderscore(s);
  }

  function formatRow(row, name, params) {
    if (params.length === 0) return name;
    if (row.style === 'colon') return `${name}: ${params.join(', ')}`;
    const sep = row.style === 'tab' ? '\t' : row.sep;
    return [name, ...params].join(sep);
  }

  const fixedParams = (params) => [...new Set(params.map((p) => snakeName(p, 'param')))];

  // Every line rewritten in its own format; lines that become the same event merge into the first.
  function fixList(text) {
    const lines = String(text).split(/\r?\n/);
    const rows = parseList(text);
    const groups = groupsOf(rows);
    const kept = new Map(); // fixed name -> { row, params }
    const changes = [];
    for (const row of rows) {
      const name = groups.get(looseKey(row.name)).target;
      const params = fixedParams(row.params);
      const first = kept.get(name);
      if (!first) { kept.set(name, { row, params }); continue; }
      first.params = [...new Set([...first.params, ...params])];
      lines[row.line - 1] = null;
      changes.push({ line: row.line, before: row.raw, after: formatRow(row, name, params), mergedInto: first.row.line });
    }
    for (const [name, { row, params }] of kept) {
      lines[row.line - 1] = formatRow(row, name, params);
      if (lines[row.line - 1] !== row.raw) changes.push({ line: row.line, before: row.raw, after: lines[row.line - 1] });
    }
    changes.sort((a, b) => a.line - b.line);
    return { text: lines.filter((l) => l !== null).join('\n'), changes };
  }

  // An online store's tracking plan with a few deliberate mistakes, so the first view shows them.
  const EXAMPLE = [
    'view_item_list: item_list_id, item_list_name, items',
    'view_item: currency, value, items',
    'select_item: item_list_name, items',
    'add_to_cart: currency, value, items',
    'addToCart: currency, value, items',
    'add-to-cart: currency, value, items',
    'add_to_wishlist: currency, value, items',
    'view_cart: currency, value, items',
    'begin checkout: currency, value, coupon, items',
    'add_shipping_info: currency, value, shipping_tier, items',
    'purchase_complete: transaction_id, currency, value, tax, shipping, items',
    'newsletter_signup: form_location',
    'session_start',
    'google_review_click: _review_source',
    'product_size_guide_opened_from_quick_view: product_id',
    'view_item: currency, value, items'
  ].join('\n');

  return { LIMITS, EXAMPLE, parseList, checkList, verdict, problemList, duplicateText, fixList, snakeName };
});
