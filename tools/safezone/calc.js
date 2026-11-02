// Ad creative safe-zone previewer: where each app's own buttons, captions and profile bar sit on a
// full-screen 9:16 ad, a scan for busy detail (text, logos) under them, and format checks.
// Runs in the browser (inlined by scripts/build.mjs, exposed as window.SafezoneCalc) and in Node (tests).
//
// Every zone is a fraction of the 9:16 frame, so it scales to any size. Sources:
//   TikTok — "TikTok Auction In-Feed Ads"  ads.tiktok.com/help/article/tiktok-auction-in-feed-ads
//     9:16 recommended, minimum 540x960 (1:1 640x640, 16:9 960x540), up to 10 minutes. TikTok publishes
//     its safe zone only as a downloadable template image and says it shrinks as the caption grows.
//     ESTIMATE: the zones below are the commonly measured 1080x1920 values (top 160px, bottom 480px,
//     60px edges, a 180px button column from 840px down).
//   Meta — "About text overlays and the Safe Zone for ads in Stories and Reels"
//     facebook.com/business/help/980593475366490, and the Meta Ads Guide (Instagram Reels, Stories):
//     Reels: leave roughly 14% top, 35% bottom and 6% each side free of text and logos. Stories: roughly
//     14% (250px) top and 20% (340px) bottom. ESTIMATE: the 6% Stories sides are borrowed from Reels.
//     Stories plays video ads under 35 seconds in full; longer ones may be split into cards. Meta
//     publishes no Reels-specific length limit, so Reels gets no length check.
//   YouTube Shorts — "YouTube Shorts ads: Asset specs and best practices"
//     support.google.com/google-ads/answer/16041697, and Google's safe-zone guide
//     services.google.com/fh/files/misc/universalsafezones-youtube.pdf: 9:16 at 1080x1920, horizontal
//     shows with blurred bars, ads up to 3 minutes with only the first 60 seconds in the Shorts feed.
//     ESTIMATE: Google draws the zone as an image; the zones below are the commonly measured values
//     (top 288px, bottom 672px, left 48px, right 192px).
//
// The busy-pixel scan is an ESTIMATE too: it cannot read text. It finds sharp brightness jumps in both
// directions (letters and logos have them, a plain or smoothly shaded background and a single straight
// line don't), scores each zone by its busiest small square, and calls it busy past a threshold.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafezoneCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FRAME_W = 1080;
  const FRAME_H = 1920;
  const TARGET_RATIO = FRAME_W / FRAME_H;
  const RATIO_TOLERANCE = 0.01;
  const SCAN = { width: 270, height: 480 }; // a quarter of 1080x1920: same detail per zone, fixed cost
  const CELL = 16; // scan pixels per side of the squares a zone is scored by
  const MIN_CELL_AREA = (CELL * CELL) / 4; // a sliver at a zone's edge is too small to judge
  const EDGE_STEP = 40; // a brightness jump (0-255) this big between neighbours is a sharp edge
  const BUSY = 0.08; // share of a square's pixels with sharp edges both ways: text or a logo
  const LOOK = 0.04; // some detail, like a shape's corner: worth a look
  const RECOMMENDED_WIDTH = 1080;

  const px = (n, of) => n / of;
  const band = (part, label, y, h) => ({ part, label, x: 0, y, w: 1, h });
  const strip = (part, label, x, w, y = 0, h = 1) => ({ part, label, x, y, w, h });
  const sides = (w) => [strip('left', 'left edge', 0, w), strip('right', 'right edge', 1 - w, w)];
  const reelsZones = () => [band('top', 'top bar', 0, 0.14), band('bottom', 'caption area', 0.65, 0.35), ...sides(0.06)];
  const META_SOURCE = 'https://www.facebook.com/business/help/980593475366490';

  const PLATFORMS = [
    {
      id: 'tiktok', name: 'TikTok', estimate: true, bars: 'black bars',
      source: 'https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads',
      estimateNote: 'TikTok publishes its safe zone as a template image, not numbers, so these are commonly measured estimates.',
      zones: [
        band('top', 'top bar', 0, px(160, FRAME_H)),
        band('bottom', 'caption area', 1 - px(480, FRAME_H), px(480, FRAME_H)),
        strip('buttons', 'like and share buttons', 1 - px(180, FRAME_W), px(180, FRAME_W), px(840, FRAME_H), px(FRAME_H - 840 - 480, FRAME_H)),
        ...sides(px(60, FRAME_W))
      ],
      minimum: { vertical: [540, 960], square: [640, 640], horizontal: [960, 540] },
      length: [{ max: 600, level: 'reject', text: 'TikTok In-Feed ads run up to 10 minutes.' }]
    },
    {
      id: 'reels', name: 'Instagram Reels', estimate: false, bars: 'bars', source: META_SOURCE,
      zones: reelsZones(), minimum: null, length: []
    },
    {
      id: 'stories', name: 'Instagram Stories', estimate: false, bars: 'bars', source: META_SOURCE,
      estimateNote: 'Meta gives the top and bottom; the 6% sides are an estimate borrowed from Reels.',
      zones: [band('top', 'profile bar', 0, 0.14), band('bottom', 'call to action', 0.8, 0.2), ...sides(0.06)],
      minimum: null,
      length: [{ max: 35, level: 'look', text: 'Stories plays ads under 35 seconds in full; longer ones may be split into cards.' }]
    },
    {
      id: 'fbreels', name: 'Facebook Reels', estimate: false, bars: 'bars', source: META_SOURCE,
      zones: reelsZones(), minimum: null, length: []
    },
    {
      id: 'shorts', name: 'YouTube Shorts', estimate: true, bars: 'blurred bars',
      source: 'https://support.google.com/google-ads/answer/16041697',
      estimateNote: 'Google shows the Shorts safe zone as an image, so these are commonly measured estimates.',
      zones: [
        band('top', 'top bar', 0, px(288, FRAME_H)),
        band('bottom', 'caption area', 1 - px(672, FRAME_H), px(672, FRAME_H)),
        strip('left', 'left edge', 0, px(48, FRAME_W)),
        strip('right', 'like and share buttons', 1 - px(192, FRAME_W), px(192, FRAME_W))
      ],
      minimum: null,
      length: [
        { max: 180, level: 'reject', text: 'Shorts ads run up to 3 minutes.' },
        { max: 60, level: 'look', text: 'Only the first 60 seconds play in the Shorts feed.' }
      ]
    }
  ];

  // --- Fitting a creative into the full-screen 9:16 frame ---

  // Where the creative is drawn, as fractions of the frame (a crop overflows it), what share of the
  // screen height it uses, and what share of the creative falls off the screen.
  function fitFrame(width, height) {
    const ratio = width / height;
    if (Math.abs(ratio - TARGET_RATIO) / TARGET_RATIO <= RATIO_TOLERANCE) return { mode: 'fill', x: 0, y: 0, w: 1, h: 1, used: 1, cut: 0 };
    const h = TARGET_RATIO / ratio;
    if (ratio > TARGET_RATIO) return { mode: 'letterbox', x: 0, y: (1 - h) / 2, w: 1, h, used: h, cut: 0 };
    return { mode: 'crop', x: 0, y: (1 - h) / 2, w: 1, h, used: 1, cut: 1 - 1 / h };
  }

  // --- The busy-pixel scan, on plain RGBA arrays ---

  const H_EDGE = 1; // a sharp jump to the pixel on the right
  const V_EDGE = 2; // a sharp jump to the pixel below
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  function edgeMap(data, width, height) {
    const lum = new Float32Array(width * height);
    for (let p = 0; p < lum.length; p++) lum[p] = luma(data, p * 4);
    const edges = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const right = x + 1 < width && Math.abs(lum[p] - lum[p + 1]) >= EDGE_STEP ? H_EDGE : 0;
        const below = y + 1 < height && Math.abs(lum[p] - lum[p + width]) >= EDGE_STEP ? V_EDGE : 0;
        edges[p] = right | below;
      }
    }
    return edges;
  }

  // The lesser of a square's two edge shares: text has sharp edges both ways, a straight line one way.
  function cellScore(edges, width, x0, y0, x1, y1) {
    let h = 0;
    let v = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        h += edges[y * width + x] & H_EDGE;
        v += (edges[y * width + x] & V_EDGE) >> 1;
      }
    }
    return Math.min(h, v) / ((x1 - x0) * (y1 - y0));
  }

  function zoneScore(edges, width, height, zone) {
    const [x0, x1] = [Math.round(zone.x * width), Math.min(width, Math.round((zone.x + zone.w) * width))];
    const [y0, y1] = [Math.round(zone.y * height), Math.min(height, Math.round((zone.y + zone.h) * height))];
    let best = 0;
    for (let y = y0; y < y1; y += CELL) {
      for (let x = x0; x < x1; x += CELL) {
        const [cx, cy] = [Math.min(x + CELL, x1), Math.min(y + CELL, y1)];
        if ((cx - x) * (cy - y) >= MIN_CELL_AREA) best = Math.max(best, cellScore(edges, width, x, y, cx, cy));
      }
    }
    return best;
  }

  // One frame, already fitted into 9:16, scored against every zone of every platform.
  function scanFrame(data, width, height) {
    const edges = edgeMap(data, width, height);
    return Object.fromEntries(PLATFORMS.map((p) => [p.id, p.zones.map((z) => ({ part: z.part, label: z.label, score: zoneScore(edges, width, height, z) }))]));
  }

  // Several video frames: each zone keeps its busiest frame.
  function mergeScans(scans) {
    return Object.fromEntries(Object.keys(scans[0]).map((id) => [id, scans[0][id].map((z, n) => ({ ...z, score: Math.max(...scans.map((s) => s[id][n].score)) }))]));
  }

  // --- Format checks ---

  const RATIOS = [[9, 16], [1, 1], [4, 5], [16, 9], [2, 3], [3, 4], [4, 3], [3, 2]];
  const near = (a, b) => Math.abs(a - b) / b <= RATIO_TOLERANCE;
  const pct = (f) => Math.round(f * 100);
  const line = (level, code, text) => ({ level, code, text });

  function ratioName(width, height) {
    const found = RATIOS.find(([w, h]) => near(width / height, w / h));
    return found ? found.join(':') : `${width}×${height}`;
  }

  function aspectLine({ width, height }, platform) {
    const fit = fitFrame(width, height);
    if (fit.mode === 'letterbox') {
      return [line('look', 'aspect', `${ratioName(width, height)} is letterboxed: it fills ${pct(fit.used)}% of the screen height, with ${platform.bars} above and below.`)];
    }
    if (fit.mode === 'crop') return [line('look', 'aspect', `Taller than 9:16, so about ${pct(fit.cut)}% is cut off the top and bottom.`)];
    return [];
  }

  function orientation(width, height) {
    if (near(width / height, 1)) return 'square';
    return width < height ? 'vertical' : 'horizontal';
  }

  function sizeLines({ width, height }, platform) {
    const found = [];
    if (width < RECOMMENDED_WIDTH) found.push(line('look', 'resolution', `Only ${width} pixels wide. 1080×1920 is recommended, so it may look soft.`));
    const min = platform.minimum && platform.minimum[orientation(width, height)];
    if (min && (width < min[0] || height < min[1])) {
      found.push(line('reject', 'minimum', `${width}×${height} is too small: ${platform.name}’s minimum is ${min[0]}×${min[1]}.`));
    }
    return found;
  }

  function duration(seconds) {
    const s = Math.round(seconds);
    return s < 60 ? `${s} seconds` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function lengthLines({ kind, duration: seconds }, platform) {
    if (kind !== 'video' || platform.length.length === 0) return [];
    if (!Number.isFinite(seconds)) return [line('look', 'length', 'Couldn’t read the video’s length, so it isn’t checked.')];
    const rule = platform.length.find((r) => seconds > r.max);
    return rule ? [line(rule.level, 'length', `${duration(seconds)} long. ${rule.text}`)] : [];
  }

  const formatChecks = (media, platform) => [...aspectLine(media, platform), ...sizeLines(media, platform), ...lengthLines(media, platform)];

  // --- Results ---

  function listLabels(zones) {
    const labels = zones.map((z) => `the ${z.label}`);
    return labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }

  function zoneLine(zones, name) {
    const covered = zones.filter((z) => z.score >= BUSY);
    if (covered.length) return [line('reject', 'covered', `Something important may sit under ${listLabels(covered)} on ${name}.`)];
    const looked = zones.filter((z) => z.score >= LOOK);
    return looked.length ? [line('look', 'detail', `Some detail sits under ${listLabels(looked)} on ${name}. Worth a look.`)] : [];
  }

  const STATUS = { covered: (n) => `Text may be covered on ${n}`, reject: (n) => `Rejected or cut on ${n}`, look: (n) => `Worth a look on ${n}`, ok: (n) => `Clear on ${n}` };

  function checkCreative(media, scan) {
    return PLATFORMS.map((platform) => {
      const lines = [...zoneLine(scan[platform.id], platform.name), ...formatChecks(media, platform)];
      const level = lines.some((l) => l.level === 'reject') ? 'reject' : lines.length ? 'look' : 'ok';
      const covered = lines.some((l) => l.code === 'covered');
      return { platform, zones: scan[platform.id], level, covered, lines, status: STATUS[covered ? 'covered' : level](platform.name) };
    });
  }

  const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
  const switchedOn = (results, enabled) => results.filter((r) => enabled.includes(r.platform.id));

  function clearHeadline(on) {
    if (on.length === 1) return `Clear on ${on[0].platform.name}`;
    return on.length === 2 ? 'Clear on both platforms' : `Clear on all ${on.length} platforms`;
  }

  function verdict(results, enabled) {
    const on = switchedOn(results, enabled);
    if (on.length === 0) return { level: 'ok', headline: 'Pick a platform to check', sub: '', covered: 0, looked: 0 };
    const all = on.flatMap((r) => r.lines);
    const covered = on.filter((r) => r.covered).length;
    const others = all.length - covered;
    const level = all.some((l) => l.level === 'reject') ? 'reject' : all.length ? 'look' : 'ok';
    const base = { level, covered, looked: all.filter((l) => l.level === 'look').length };
    if (covered) {
      return { ...base, headline: `${covered} of ${plural(on.length, 'platform')} would cover your text`, sub: others ? `Plus ${plural(others, 'thing')} worth a look.` : '' };
    }
    if (all.length) return { ...base, headline: 'No platform covers your text', sub: `${plural(all.length, 'thing')} worth a look.` };
    return { ...base, headline: clearHeadline(on), sub: 'Nothing important sits under the app’s buttons or captions.' };
  }

  const TAGS = { covered: 'covered', reject: 'rejected', look: 'worth a look' };

  function problemList(results, enabled) {
    const on = switchedOn(results, enabled);
    const lines = on.flatMap((r) => r.lines.map((l) => `${r.platform.name} (${TAGS[l.code === 'covered' ? 'covered' : l.level]}): ${l.text}`));
    return [verdict(results, enabled).headline, '', ...lines].join('\n');
  }

  // The prefilled example: a 9:16 product ad whose headline and button sit low enough that Reels,
  // Facebook Reels and Shorts cover them while TikTok and Stories don't. The page draws it on a canvas.
  const EXAMPLE = {
    width: FRAME_W,
    height: FRAME_H,
    brand: 'NORTHLINE',
    headline: ['Ice cold', 'for 24 hours'],
    cta: 'Shop now',
    boxes: [
      { id: 'brand', text: true, x: 0.09, y: 0.17, w: 0.4, h: 0.035 },
      { id: 'product', text: false, x: 0.3, y: 0.24, w: 0.4, h: 0.32 },
      { id: 'headline', text: true, x: 0.09, y: 0.585, w: 0.7, h: 0.085 },
      { id: 'cta', text: true, x: 0.09, y: 0.685, w: 0.4, h: 0.05 }
    ]
  };

  return { PLATFORMS, SCAN, BUSY, LOOK, EXAMPLE, fitFrame, edgeMap, zoneScore, scanFrame, mergeScans, formatChecks, checkCreative, verdict, problemList };
});
