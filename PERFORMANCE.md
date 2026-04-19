# Footnote — Performance Targets & Measurement Guide

This document records the Lighthouse performance targets for the Footnote frontend and explains how to measure each metric during development and in CI.

---

## Targets

| Metric | Desktop | Mobile |
|---|---|---|
| Lighthouse Performance score | ≥ 90 | ≥ 80 |
| Lighthouse Accessibility score | ≥ 90 | ≥ 90 |
| Lighthouse Best Practices score | ≥ 90 | ≥ 90 |
| Time to First Byte (TTFB) | < 200 ms | < 200 ms |
| Largest Contentful Paint (LCP) | < 2.5 s | < 4.0 s |
| Total Blocking Time (TBT) | < 200 ms | < 600 ms |
| Cumulative Layout Shift (CLS) | < 0.1 | < 0.1 |

---

## 1. Running Lighthouse in Chrome DevTools

1. Build and preview the production bundle locally:
   ```bash
   cd frontend
   npm run build
   npm run preview
   # App is served at http://localhost:4173
   ```

2. Open Chrome and navigate to `http://localhost:4173`.

3. Open DevTools (`F12` / `⌘⌥I`), go to the **Lighthouse** tab.

4. Select the categories you want (Performance, Accessibility, Best Practices) and the device mode (Desktop or Mobile).

5. Click **Analyze page load** and wait for the report.

**Desktop vs. Mobile:** Lighthouse simulates mobile using a throttled CPU (4× slowdown) and a slow 4G network. Always check both profiles before a release.

---

## 2. Measuring TTFB

TTFB is the time from the HTTP request being sent until the first byte of the response body arrives. It reflects server response time and network round-trip latency.

### Via Chrome DevTools Network panel

1. Open DevTools → **Network** tab, check **Disable cache**.
2. Reload the page.
3. Click the document request (the HTML file) in the waterfall.
4. In the **Timing** panel, read **Waiting for server response** — this is TTFB.

### Via `curl`

```bash
curl -o /dev/null -s -w "TTFB: %{time_starttransfer}s\n" https://your-production-url.com
```

A value below `0.200` (200 ms) meets the target.

### Via WebPageTest

1. Visit https://www.webpagetest.org.
2. Enter your URL, select a location close to your server.
3. Run the test — TTFB is shown on the **Summary** and **Waterfall** views.

---

## 3. Measuring Lighthouse Score in CI

Install and run Lighthouse CLI as part of your build pipeline:

```bash
# Install once
npm install --save-dev lighthouse

# Start the preview server in the background, then run Lighthouse
npm run build
npm run preview &
PREVIEW_PID=$!

npx lighthouse http://localhost:4173 \
  --output=json \
  --output-path=./lighthouse-report.json \
  --chrome-flags="--headless --no-sandbox" \
  --form-factor=desktop \
  --preset=desktop

kill $PREVIEW_PID
```

Parse the JSON report to assert targets:

```js
// ci/assert-lighthouse.js
import report from "./lighthouse-report.json" assert { type: "json" };

const score = (key) => Math.round(report.categories[key].score * 100);

const TARGETS = {
  performance: 90,
  accessibility: 90,
  "best-practices": 90,
};

let failed = false;
for (const [key, min] of Object.entries(TARGETS)) {
  const actual = score(key);
  const pass = actual >= min;
  console.log(`${pass ? "✓" : "✗"} ${key}: ${actual} (target ≥ ${min})`);
  if (!pass) failed = true;
}

process.exit(failed ? 1 : 0);
```

---

## 4. Analysing Bundle Size

Use `rollup-plugin-visualizer` to generate an interactive treemap showing how each module contributes to the bundle (see `frontend/vite.config.ts` for setup instructions). Run it whenever:

- A new dependency is added.
- A Lighthouse score drops more than 5 points.
- The `chunkSizeWarningLimit` warning fires during `npm run build`.

---

## 5. Quick Checklist Before a Release

- [ ] `npm run build` completes with no chunk-size warnings.
- [ ] `npm run preview` + Lighthouse Desktop score ≥ 90 for Performance.
- [ ] `npm run preview` + Lighthouse Mobile score ≥ 80 for Performance.
- [ ] TTFB of the production URL < 200 ms (via `curl` or WebPageTest).
- [ ] Lighthouse Accessibility score ≥ 90 (see `CONTRIBUTING.md` for a11y guidelines).
- [ ] CLS < 0.1 — verify skeleton heights match live content heights (all panels use `h-[620px]` or matching fixed heights to prevent shift).
