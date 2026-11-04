// The bundled tool must stand alone: a Share serves one file and blocks outside fetches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineTool, TOOLS } from './build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// One function each tool's calc.js must define, proving its logic made it into the bundle.
const LOGIC_MARKER = { roas: /computeBreakEven/, utm: /function buildUrl/, serp: /function fitText/, rsa: /function arrangements/, feed: /function checkFeed/, listing: /function checkListing/, safezone: /function scanFrame/, ga4: /function fixList/, inbox: /function inboxPreview/ };

for (const tool of TOOLS) {
  test(`the bundled ${tool} tool has no external stylesheet or script references`, () => {
    const html = inlineTool(tool);
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i, 'stylesheet still linked');
    assert.doesNotMatch(html, /<script[^>]+src=/i, 'script still linked');
    assert.match(html, LOGIC_MARKER[tool], 'calc.js was inlined');
    assert.match(html, /--lime:/, 'tokens.css was inlined');
    assert.doesNotMatch(html, /<img[^>]+src="(?!data:)/i, 'an image still points at a file');
  });

  test(`the ${tool} tool says Built with Omniscio, since a Share may not show its own badge`, () => {
    assert.match(inlineTool(tool), /href="https:\/\/omniscio\.com"[\s\S]*?Built with <b>Omniscio<\/b>/);
  });
}

for (const tool of ['utm', 'serp', 'rsa', 'feed', 'listing', 'safezone', 'ga4', 'inbox']) {
  test(`the ${tool} tool puts user text on the page as text, never as HTML`, () => {
    assert.doesNotMatch(readFileSync(join(ROOT, 'tools', tool, 'index.html'), 'utf8'),
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
}

test('the hub serves the same look as the tools (docs/tokens.css matches shared/tokens.css)', () => {
  const shared = readFileSync(join(ROOT, 'shared', 'tokens.css'), 'utf8');
  const hub = readFileSync(join(ROOT, 'docs', 'tokens.css'), 'utf8');
  assert.equal(hub, shared, 'run `npm run build` to refresh docs/tokens.css');
});
