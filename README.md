<div align="center">

# Free marketing tools, one a day

**Ten free, one-page marketing tools in ten days. No sign-up, works on your phone.**

![HTML](https://img.shields.io/badge/HTML-single--file-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/hub-GitHub%20Pages-222?logo=github)

[Open the hub](https://freemarketingtools.github.io/) · Built with [Omniscio](https://omniscio.com)

</div>

## Overview

A 10-day challenge: every day a new free tool for marketers and online store owners. Each tool is one
self-contained HTML page hosted as an Omniscio Share, and this repo's hub page lists them all as they
ship.

## Features

- **Day 1 — Break-even ROAS calculator.** The lowest ROAS where your ads stop losing money, with
  discounts, payment fees, shipping and returns counted, plus the target ROAS (as a Google Ads %) for
  the profit you want to keep.
- **Day 2 — UTM link builder.** Tagged links that land in the right GA4 channel. Flags capitals,
  spaces, stray whitespace, characters that get encoded, missing fields, UTMs already in the pasted
  link, and mediums GA4's default channel rules don't recognise, each with a one-click fix. Bulk mode
  takes rows pasted from a spreadsheet and gives back a table of finished links with Fix all and
  Copy all.
- **Day 3 — Search result preview.** A Google result and a search ad on desktop and mobile side by
  side, cut where Google would cut them, measured by pixel width in Google's fonts rather than by
  character count. Live width meters for the title and description, warnings for cut text and a focus
  keyword missing from the title, and 30/90/15 character counters for ad headlines, descriptions and
  paths. The pixel limits are commonly measured estimates; Google doesn't publish them.
- **Day 4 — Search ad checker.** Checks a responsive search ad (up to 15 headlines and 4 descriptions,
  each with an optional pin) for what Google's editor lets through: lines over the limit, duplicates and
  near-duplicates, too few assets or too few unique headlines, pins that show one line every time or
  leave a spot nothing can fill, and the punctuation and capitals Google rejects. A Sponsored preview on
  desktop and mobile shows one ad the pins allow, Shuffle draws another, and a big number counts every
  full ad the pins leave. Rules cite Google's help pages; the 8-headline floor and the ALL-CAPS rule are
  labelled estimates.
- **Day 5 — Merchant Center feed checker.** Paste a product feed, pick a file or drop one in, and every
  row Google would reject or limit turns red with the reason in plain English, before you upload it.
  Reads comma or tab files with quoted cells, columns in any order and the usual aliases (`g:title`,
  `image link`). Checks required attributes, length limits, price, availability, condition, GTIN check
  digits, URLs, promotional titles and duplicate ids, with a headline count, the most common problems,
  Show only problems and Copy problem list. A 50,000-row feed checks in about a second, with the first
  300 rows drawn. Nothing is uploaded. Rules cite Google's help pages; the ALL-CAPS rule is a labelled
  estimate.
- **Day 6 — Amazon listing checker.** Paste a brand, title, up to 5 bullets, a description and backend
  search terms, and see what Amazon would reject or suppress before you publish. Live counters for every
  field turn coral past the limit, with search terms counted in bytes (an accented letter costs 2) and a
  title limit you can lower for stricter categories. Flags repeated title words, banned title characters
  outside the brand, ALL-CAPS words, promotional, pricing and shipping talk, contact details, links,
  repeated bullets, wasted search terms (the brand, words already used, punctuation, subjective words)
  and banned claims (medical, FDA, pesticide-style, guarantees), each with the exact phrase highlighted
  in place. A headline verdict and Copy problem list. Nothing is uploaded. Rules cite Amazon's Seller
  Central pages; the bullet and description limits, ALL-CAPS rule and phrase lists are labelled estimates.
- **Day 7 — Ad safe-zone checker.** Drop in a vertical ad (PNG, JPEG, WebP, MP4 or WebM) and see it on
  TikTok, Instagram Reels, Instagram Stories, Facebook Reels and YouTube Shorts at once, each under a
  neutral mock of that app's buttons, captions and profile bar, with the covered zones shaded coral. It
  scans those zones for sharp, high-contrast detail like text and logos and says per platform whether
  something important may sit under them, plus aspect ratio (letterboxed or cropped), resolution and video
  length checks. Each platform can be switched off, the mock UI can be hidden, and Copy problem list
  gives the findings. A canvas-drawn example opens on 3 of 5 platforms covering its text. Nothing is
  uploaded. Reels and Stories zones are Meta's published figures; TikTok, Shorts and the cover check
  itself are labelled estimates.
- **Day 8 — GA4 event name checker.** Paste a tracking plan (one event per line, parameters after a colon,
  or a column or rows from a sheet) and see which events GA4 rejects or drops and which quietly split or
  weaken reports, before you ship the tracking. Coral flags names over 40 characters, names not starting
  with a letter, spaces, dashes and dots, reserved names like `session_start`, reserved prefixes
  (`google_`, `ga_`, `firebase_`, and `_` or `gtag.` on parameters), bad parameter names and more than 25
  parameters. Amber flags spellings that only differ by case or style (`addToCart` next to `add_to_cart`),
  near-misses of Google's recommended events (`purchase_complete`, `begin-checkout`) with what you lose,
  names GA4 already collects on web, and duplicate lines. Fix names rewrites every line to snake_case and
  the recommended names, keeps the parameters, merges lines that became the same event and shows a
  before/after with Undo and Copy fixed list. A headline verdict, the list highlighted in place and Copy
  problem list. Nothing is uploaded. Rules cite Google's help and developer pages; web-only and app-only
  rules are labelled, and the web side of the event-name prefixes and the near-miss list are estimates.
- **Day 9 — Email subject line preview.** Type a sender name, subject line and preheader and see them in
  neutral mocks of four inboxes: Gmail on a phone, Apple Mail on an iPhone, Outlook on desktop and Gmail on
  desktop, in light or dark mode. Each is cut by rendered pixel width in that inbox's font, mid-word with the
  "…" marked, and says in plain English which words are hidden ("your subject stops at …, so “40% off” is
  hidden"). Coral flags a key offer or number after the cut, an empty preheader (the inbox shows the email's
  first line instead) and a preheader that repeats the subject. Amber flags other cut text, a short preheader,
  ALL CAPS, piled-up `!!!`, 3+ emoji and spam trigger words (labelled a guide, not a rule). A headline verdict
  and Copy problem list. Nothing is uploaded. Every width is a labelled estimate for a named screen size,
  sourced from each platform's type scale.
- **Day 10 — A/B test calculator in plain English.** Two modes. *Check my test*: enter visitors and
  conversions for A and B and the days run so far, and get one sentence back, such as "B converts 15%
  better than A so far, but you can't be sure yet. Keep it running about 16 more days at your current
  traffic." It says who is ahead, how sure you can be ("not sure yet", "fairly sure", "sure") and what to do
  next. Days left always lands the test on a whole week. A traffic slider moves the days left live. The
  numbers sit underneath: both conversion rates, the lift with its range, confidence, visitors needed per
  version and the stop day. Coral flags peeking (significant before the planned end), a test under a week,
  a split far from 50/50 (a chi-square test for sample ratio mismatch) and under 10 conversions. Amber flags
  part weeks, small counts where one order swings the lift, and lifts too small to show within 8 weeks.
  *Plan a test*: conversion rate now, the smallest lift you care about (+5/10/20% presets) and daily
  visitors give the visitors per version and the whole weeks to run. Standard statistics: a two-proportion
  z-test, 95% confidence and 80% power by default (changeable under Advanced), and R's `power.prop.test`
  sample size. It assumes a fixed-length test with one main metric. The tests check the maths against
  published values. Copy summary gives a Slack-ready verdict with the numbers. Nothing is uploaded.
- **The hub.** A brand column with a 10-segment progress bar, and a grid of all 10 days: shipped tools as cards with a screenshot, future days locked. When all 10 are listed it reads "Day 10 of 10 · Complete" and "All 10 tools are out". A floating Made with Omniscio badge, the
  same one an Omniscio Share carries, and a link preview in the hub's own look that stays neutral for X.
- **Phone-first.** Every page is checked at 390 px wide with no sideways scrolling.
- **No accounts, no tracking, nothing stored.** Each tool runs entirely in the browser.

## Tech stack

| Part | Choice | Why |
| --- | --- | --- |
| Tools | One HTML file each, vanilla JS | An Omniscio Share hosts a single file and blocks outside requests |
| Hub | Static HTML + `tools.json` on GitHub Pages | Adding a day is one list entry |
| Look | `shared/tokens.css`: dark ink, acid-lime accent, coral for losses | One design across the hub and every tool |
| Tests | `node --test` | No dependencies to install |
| Page checks | Playwright + local Chrome | Phone and desktop, under the Share's sandbox rules |

## Project structure

```
docs/                 the hub, served by GitHub Pages
  index.html          renders tools.json; link-preview tags stay Omniscio-free
  tools.json          one entry per released day: day, name, blurb, url, shot
  shots/<tool>.png    card thumbnails (written by render-shots.cjs)
  mark.svg            the brand mark
  og.png              the 1200x630 link-preview image
  tokens.css          copy of shared/tokens.css (written by the build)
shared/tokens.css     the one design-token file
tools/<tool>/         a tool: index.html, its logic, and its tests
scripts/
  build.mjs           inlines each tool into dist/<tool>.html and refreshes docs/tokens.css
  check-ui.cjs        phone/desktop checks for every tool (TOOL_CHECKS) and the hub
  render-og.cjs       regenerates docs/og.png from og-card.html
  render-shots.cjs    renders each dist/<tool>.html into docs/shots/<tool>.png
tests/hub.test.mjs    hub rules: neutral preview, valid tools.json, Built with Omniscio
upcoming.json         finished tools waiting for their day, same shape as docs/tools.json
```

## Getting started

**Prerequisites:** Node 18 or newer. For the page checks and the preview image: Google Chrome, and
Playwright available on `NODE_PATH` (set `CHROME_PATH` if Chrome is not in the default Windows place).

```bash
npm test              # all unit tests
npm run build         # writes dist/<tool>.html and docs/tokens.css
npm run check:ui      # phone + desktop checks (needs Playwright + Chrome)
```

### Adding a day's tool

1. Build it in `tools/<name>/`: an `index.html` that links `../../shared/tokens.css`, loads its logic
   from `calc.js`, and keeps the Built with Omniscio footer (copy the ROAS tool's), with tests beside it.
   Add the name to `TOOLS` in `scripts/build.mjs`, a marker from its `calc.js` to `LOGIC_MARKER` in
   `scripts/build.test.mjs`, and a check function to `TOOL_CHECKS` in `scripts/check-ui.cjs` (a tool
   missing from `TOOL_CHECKS` is not checked at all).
2. `npm run build`, then `node scripts/render-shots.cjs` for the card thumbnail, then `npm run check:ui`.
   The page check serves each tool under the Share's sandbox rules; if the tool copies to the
   clipboard, test every fallback (see the UTM tool's checks). The `PASS` or `FAIL` line is the verdict.
   On a busy machine the script can occasionally hang after printing it, while the browser shuts down.
   The verdict has already been printed, so stop the script and keep it.
3. Publish `dist/<name>.html` as an Omniscio Share that never expires. Its `url` is the
   `https://shares.omniscio.com/s/<token>` address, never the `omnisc.io` short link: that is a
   second domain, and when it fails to resolve the hub's Open tool button goes nowhere.
4. Add one entry (`day`, `name`, `blurb`, `url`, `shot: "shots/<name>.png"`) to `upcoming.json`.
   Tools are built ahead of their day, and the hub must only show days already posted on X.
5. On the tool's day, move its entry from `upcoming.json` to the end of `docs/tools.json` and push.
   The hub fills that day's slot itself.

### Regenerating the preview image

Edit `scripts/og-card.html`, then run `node scripts/render-og.cjs`. The card reads `shared/tokens.css`,
so it follows the hub's colours. Keep its bottom-left corner empty (X lays the page title over it) and
keep it free of the word Omniscio; `tests/hub.test.mjs` enforces that for the preview tags.
