// Turns each tool's page into ONE self-contained HTML file (a Share hosts single files),
// and copies the shared look into the hub so GitHub Pages can serve it.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS = ['roas', 'utm', 'serp', 'rsa', 'feed', 'listing'];
const TOKENS = join(ROOT, 'shared', 'tokens.css');

const ORB = join(ROOT, 'docs', 'orb.png');

const STYLESHEET_TAG = '<link rel="stylesheet" href="../../shared/tokens.css">';
const SCRIPT_TAG = '<script src="calc.js"></script>';
const ORB_SRC = 'src="../../docs/orb.png"';

function replaceOnce(html, tag, replacement, tool) {
  if (!html.includes(tag)) throw new Error(`${tool}/index.html is missing ${tag}`);
  return html.replace(tag, () => replacement);
}

export function inlineTool(tool) {
  const dir = join(ROOT, 'tools', tool);
  let html = readFileSync(join(dir, 'index.html'), 'utf8');
  html = replaceOnce(html, STYLESHEET_TAG, `<style>\n${readFileSync(TOKENS, 'utf8')}</style>`, tool);
  html = replaceOnce(html, SCRIPT_TAG, `<script>\n${readFileSync(join(dir, 'calc.js'), 'utf8')}</script>`, tool);
  html = replaceOnce(html, ORB_SRC, `src="data:image/png;base64,${readFileSync(ORB).toString('base64')}"`, tool);
  return html;
}

function main() {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  for (const tool of TOOLS) {
    const out = join(ROOT, 'dist', `${tool}.html`);
    writeFileSync(out, inlineTool(tool));
    console.log(`built ${out}`);
  }
  copyFileSync(TOKENS, join(ROOT, 'docs', 'tokens.css'));
  console.log('copied shared/tokens.css -> docs/tokens.css');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
