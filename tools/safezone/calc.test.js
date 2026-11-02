// Ad safe-zone previewer: zone geometry, fitting a creative into 9:16, the busy-pixel scan on plain
// RGBA arrays, format checks, the verdict and the copied problem list.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLATFORMS, SCAN, BUSY, LOOK, EXAMPLE,
  fitFrame, edgeMap, zoneScore, scanFrame, mergeScans, formatChecks, checkCreative, verdict, problemList
} = require('./calc.js');

const ALL = PLATFORMS.map((p) => p.id);
const byId = (id) => PLATFORMS.find((p) => p.id === id);

// --- Plain pixel arrays, the same shape a canvas getImageData returns ---
function canvas(width, height, grey = 200) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = grey; data[i + 3] = 255; }
  return { data, width, height };
}
function paint(img, x0, y0, w, h, shade) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4;
      const v = shade(x, y);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
  }
}
// Text-like detail: thin dark strokes on a light ground, like letters.
const text = (img, x, y, w, h) => paint(img, x, y, w, h, (px, py) => ((px % 4 < 2) && (py % 6 < 4) ? 20 : 235));
const frame = () => canvas(SCAN.width, SCAN.height);
const at = (fy) => Math.round(fy * SCAN.height);
const scoreOf = (scan, id, part) => scan[id].find((z) => z.part === part).score;

// --- Zones ---

test('every platform has zones inside the frame, a source link, and says whether its numbers are estimates', () => {
  assert.deepEqual(ALL, ['tiktok', 'reels', 'stories', 'fbreels', 'shorts']);
  for (const p of PLATFORMS) {
    assert.ok(p.zones.length >= 3, `${p.id} has too few zones`);
    assert.equal(typeof p.estimate, 'boolean', `${p.id} must say if it is an estimate`);
    assert.match(p.source, /^https:\/\/(ads\.tiktok\.com|www\.facebook\.com|support\.google\.com)\//, `${p.id} source`);
    for (const z of p.zones) {
      assert.ok(z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0, `${p.id}/${z.part} has a size`);
      assert.ok(z.x + z.w <= 1 + 1e-9 && z.y + z.h <= 1 + 1e-9, `${p.id}/${z.part} stays in the frame`);
      assert.ok(z.label && !/[A-Z]/.test(z.label[0]), `${p.id}/${z.part} label reads mid-sentence`);
    }
  }
});

test('Meta’s published figures: Reels 14% top, 35% bottom, 6% sides; Stories 14% top, 20% bottom', () => {
  for (const id of ['reels', 'fbreels']) {
    const z = Object.fromEntries(byId(id).zones.map((x) => [x.part, x]));
    assert.equal(z.top.h, 0.14);
    assert.equal(z.bottom.h, 0.35);
    assert.equal(+(1 - z.bottom.y).toFixed(6), 0.35);
    assert.equal(z.left.w, 0.06);
    assert.equal(z.right.w, 0.06);
    assert.equal(byId(id).estimate, false);
  }
  const s = Object.fromEntries(byId('stories').zones.map((x) => [x.part, x]));
  assert.equal(s.top.h, 0.14);
  assert.equal(s.bottom.h, 0.2);
});

test('TikTok and YouTube Shorts are marked as estimates, with a reason the page can show', () => {
  for (const id of ['tiktok', 'shorts']) {
    assert.equal(byId(id).estimate, true);
    assert.match(byId(id).estimateNote, /estimate/i);
  }
  assert.ok(byId('tiktok').zones.some((z) => z.part === 'buttons'), 'TikTok has its button column');
});

// --- Fitting a creative into the 9:16 screen ---

test('fitFrame: 9:16 fills the screen, wider is letterboxed, taller is cropped', () => {
  assert.deepEqual(fitFrame(1080, 1920), { mode: 'fill', x: 0, y: 0, w: 1, h: 1, used: 1, cut: 0 });
  assert.equal(fitFrame(720, 1280).mode, 'fill', '720x1280 is 9:16 too');
  const square = fitFrame(1080, 1080);
  assert.equal(square.mode, 'letterbox');
  assert.equal(square.w, 1);
  assert.equal(+square.h.toFixed(4), 0.5625, 'a square uses 56% of the screen height');
  assert.equal(+square.y.toFixed(4), +((1 - 0.5625) / 2).toFixed(4), 'centred');
  assert.equal(+fitFrame(1080, 1350).used.toFixed(2), 0.7, '4:5 uses 70%');
  const tall = fitFrame(1080, 2340);
  assert.equal(tall.mode, 'crop');
  assert.ok(tall.h > 1 && tall.y < 0, 'drawn taller than the screen, overflowing top and bottom');
  assert.equal(+tall.cut.toFixed(2), 0.18, 'about 18% of a 9:19.5 creative is cut');
});

// --- The busy-pixel scan ---

test('edgeMap marks sharp brightness jumps and ignores a plain background and a smooth gradient', () => {
  const plain = canvas(40, 40);
  assert.equal(edgeMap(plain.data, 40, 40).reduce((a, b) => a + b, 0), 0, 'plain is not busy');
  const gradient = canvas(40, 40);
  paint(gradient, 0, 0, 40, 40, (x, y) => 40 + (x + y) * 2);
  assert.equal(edgeMap(gradient.data, 40, 40).reduce((a, b) => a + b, 0), 0, 'a smooth gradient is not busy');
  const words = canvas(40, 40);
  text(words, 0, 0, 40, 40);
  assert.ok(edgeMap(words.data, 40, 40).reduce((a, b) => a + b, 0) > 400, 'text strokes are edges');
});

test('zoneScore is the busiest cell, so a small CTA in a big zone still counts', () => {
  const img = frame();
  text(img, 100, at(0.8), 60, 20); // a small button label low in the frame
  const edges = edgeMap(img.data, img.width, img.height);
  const bottom35 = { part: 'bottom', x: 0, y: 0.65, w: 1, h: 0.35 };
  assert.ok(zoneScore(edges, img.width, img.height, bottom35) >= BUSY, 'the busiest cell decides');
  const top = { part: 'top', x: 0, y: 0, w: 1, h: 0.14 };
  assert.equal(zoneScore(edges, img.width, img.height, top), 0, 'nothing up top');
});

test('one clean line through a zone is below "worth a look"; a box corner is at most a look', () => {
  const zone = { part: 'bottom', x: 0, y: 0.65, w: 1, h: 0.35 };
  const line = frame();
  paint(line, 0, at(0.8), SCAN.width, 1, () => 30); // a horizon line or letterbox edge
  assert.ok(zoneScore(edgeMap(line.data, line.width, line.height), line.width, line.height, zone) < LOOK, 'a single line is not text');
  const box = frame();
  paint(box, 100, at(0.6), 100, 100, () => 40); // a plain product block reaching into the zone
  const score = zoneScore(edgeMap(box.data, box.width, box.height), box.width, box.height, zone);
  assert.ok(score < BUSY, `a plain block’s corner is not text (${score})`);
});

test('scanFrame scores every zone of every platform; mergeScans keeps the worst frame', () => {
  const quiet = frame();
  const busy = frame();
  text(busy, 30, at(0.7), 150, 20); // a headline at 70% of the height
  const a = scanFrame(quiet.data, quiet.width, quiet.height);
  const b = scanFrame(busy.data, busy.width, busy.height);
  assert.deepEqual(Object.keys(a), ALL);
  assert.equal(scoreOf(a, 'reels', 'bottom'), 0);
  assert.ok(scoreOf(b, 'reels', 'bottom') >= BUSY, 'Reels covers 65% down');
  assert.equal(scoreOf(b, 'tiktok', 'bottom'), 0, 'TikTok’s caption starts at 75%');
  assert.equal(scoreOf(b, 'stories', 'bottom'), 0, 'Stories’ bottom starts at 80%');
  const merged = mergeScans([a, b]);
  assert.equal(scoreOf(merged, 'reels', 'bottom'), scoreOf(b, 'reels', 'bottom'));
  assert.deepEqual(mergeScans([a]), a);
});

// --- Format checks ---

const IMAGE = { kind: 'image', width: 1080, height: 1920 };
const lines = (media, id) => formatChecks(media, byId(id));

test('a 1080x1920 image passes every format check on every platform', () => {
  for (const id of ALL) assert.deepEqual(lines(IMAGE, id), [], id);
});

test('4:5 and 1:1 are letterboxed (amber) with the share of the screen they use', () => {
  const four = lines({ kind: 'image', width: 1080, height: 1350 }, 'tiktok');
  assert.equal(four.length, 1);
  assert.equal(four[0].level, 'look');
  assert.match(four[0].text, /^4:5 is letterboxed: it fills 70% of the screen height, with black bars above and below\.$/);
  assert.match(lines({ kind: 'image', width: 1080, height: 1080 }, 'shorts')[0].text, /1:1 .*56% .*blurred bars/);
  assert.match(lines({ kind: 'image', width: 1080, height: 1080 }, 'reels')[0].text, /1:1 is letterboxed/);
});

test('taller than 9:16 is cropped (amber) and says how much is cut', () => {
  const [line] = lines({ kind: 'image', width: 1080, height: 2340 }, 'stories');
  assert.equal(line.level, 'look');
  assert.equal(line.text, 'Taller than 9:16, so about 18% is cut off the top and bottom.');
});

test('resolution: under 1080 wide is amber everywhere; under TikTok’s minimum is coral on TikTok', () => {
  const soft = { kind: 'image', width: 720, height: 1280 };
  assert.deepEqual(lines(soft, 'reels'), [{ level: 'look', code: 'resolution', text: 'Only 720 pixels wide. 1080×1920 is recommended, so it may look soft.' }]);
  const tiny = { kind: 'image', width: 480, height: 854 };
  const tt = lines(tiny, 'tiktok');
  assert.equal(tt.find((l) => l.code === 'minimum').level, 'reject');
  assert.match(tt.find((l) => l.code === 'minimum').text, /TikTok’s minimum is 540×960/);
  assert.equal(lines(tiny, 'shorts').some((l) => l.code === 'minimum'), false, 'Google publishes no minimum');
  assert.match(lines({ kind: 'image', width: 600, height: 600 }, 'tiktok').find((l) => l.code === 'minimum').text, /640×640/);
});

test('video length against each platform’s documented limits', () => {
  const video = (duration) => ({ kind: 'video', width: 1080, height: 1920, duration });
  assert.deepEqual(lines(video(20), 'tiktok'), []);
  assert.equal(lines(video(601), 'tiktok')[0].level, 'reject');
  assert.match(lines(video(601), 'tiktok')[0].text, /up to 10 minutes/);
  assert.match(lines(video(75), 'shorts')[0].text, /Only the first 60 seconds play in the Shorts feed/);
  assert.equal(lines(video(75), 'shorts')[0].level, 'look');
  assert.equal(lines(video(181), 'shorts')[0].level, 'reject');
  assert.match(lines(video(40), 'stories')[0].text, /under 35 seconds in full/);
  assert.deepEqual(lines(video(34), 'stories'), []);
  assert.deepEqual(lines(video(3000), 'reels'), [], 'Meta publishes no Reels length limit');
  assert.match(lines(video(Infinity), 'tiktok')[0].text, /Couldn’t read the video’s length/);
  assert.deepEqual(lines(video(Infinity), 'fbreels'), [], 'no rule, so nothing to say');
  assert.match(lines(video(601), 'tiktok')[0].text, /^10:01 long\./);
  assert.match(lines(video(40), 'stories')[0].text, /^40 seconds long\./);
});

// --- Results, verdict and the problem list ---

function scanWith(covered = [], looked = []) {
  const scan = scanFrame(frame().data, SCAN.width, SCAN.height);
  for (const [id, part, score] of [...covered.map(([i, p]) => [i, p, BUSY]), ...looked.map(([i, p]) => [i, p, LOOK])]) {
    scan[id].find((z) => z.part === part).score = score;
  }
  return scan;
}

test('checkCreative gives each platform a plain-English zone line and its format lines', () => {
  const results = checkCreative(IMAGE, scanWith([['tiktok', 'bottom'], ['tiktok', 'buttons']], [['shorts', 'top']]));
  const tt = results.find((r) => r.platform.id === 'tiktok');
  assert.equal(tt.level, 'reject');
  assert.deepEqual(tt.lines[0], { level: 'reject', code: 'covered', text: 'Something important may sit under the caption area and the like and share buttons on TikTok.' });
  const shorts = results.find((r) => r.platform.id === 'shorts');
  assert.equal(shorts.level, 'look');
  assert.equal(shorts.lines[0].text, 'Some detail sits under the top bar on YouTube Shorts. Worth a look.');
  const reels = results.find((r) => r.platform.id === 'reels');
  assert.equal(reels.level, 'ok');
  assert.equal(reels.status, 'Clear on Instagram Reels');
  assert.deepEqual(reels.lines, []);
});

test('verdict counts the platforms that would cover the text, out of the ones switched on', () => {
  const results = checkCreative(IMAGE, scanWith([['reels', 'bottom'], ['fbreels', 'bottom'], ['shorts', 'bottom']]));
  assert.equal(verdict(results, ALL).headline, '3 of 5 platforms would cover your text');
  assert.equal(verdict(results, ALL).level, 'reject');
  assert.equal(verdict(results, ['tiktok', 'reels']).headline, '1 of 2 platforms would cover your text');
  assert.equal(verdict(results, ['tiktok', 'stories']).headline, 'Clear on both platforms');
  assert.equal(verdict(results, ['tiktok']).headline, 'Clear on TikTok');
  assert.equal(verdict(results, []).headline, 'Pick a platform to check');
  const clean = checkCreative(IMAGE, scanWith());
  assert.deepEqual(verdict(clean, ALL), { level: 'ok', headline: 'Clear on all 5 platforms', sub: 'Nothing important sits under the app’s buttons or captions.', covered: 0, looked: 0 });
  const looks = checkCreative({ kind: 'image', width: 1080, height: 1350 }, scanWith());
  assert.equal(verdict(looks, ALL).level, 'look');
  assert.equal(verdict(looks, ALL).headline, 'No platform covers your text');
  assert.equal(verdict(looks, ALL).sub, '5 things worth a look.');
});

test('problemList is the headline plus one line per problem, only for platforms switched on', () => {
  const results = checkCreative({ kind: 'image', width: 720, height: 1280 }, scanWith([['reels', 'bottom']]));
  const text = problemList(results, ['reels', 'tiktok']);
  assert.equal(text.split('\n')[0], '1 of 2 platforms would cover your text');
  assert.equal(text.split('\n')[1], '');
  assert.match(text, /\nInstagram Reels \(covered\): Something important may sit under the caption area on Instagram Reels\./);
  assert.match(text, /\nTikTok \(worth a look\): Only 720 pixels wide/);
  assert.doesNotMatch(text, /Shorts|Stories|Facebook/);
});

// --- The prefilled example ---

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('the example puts its text where Reels, Facebook Reels and Shorts cover it, but TikTok and Stories don’t', () => {
  assert.deepEqual([EXAMPLE.width, EXAMPLE.height], [1080, 1920]);
  const textBoxes = EXAMPLE.boxes.filter((b) => b.text);
  assert.ok(textBoxes.length >= 3);
  const covers = (id) => byId(id).zones.some((z) => textBoxes.some((b) => overlaps(z, b)));
  assert.deepEqual(ALL.filter(covers), ['reels', 'fbreels', 'shorts']);
});
