#!/usr/bin/env node
/**
 * Browser performance harness (Playwright Core, no project dependency).
 *
 * Usage:
 *   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core/index.mjs \
 *     node scripts/browser-perf.mjs --base http://127.0.0.1:4327 --label before
 *
 * Playwright is intentionally not a project dependency. Install it ad hoc:
 *   npm i --no-save playwright-core        # or `npx -p playwright-core`
 * and point PLAYWRIGHT_CORE_PATH at its index.mjs (browsers come from the
 * standard ~/.cache/ms-playwright install).
 *
 * Measures per route, on desktop and throttled mobile:
 *   TTFB, FCP, LCP, CLS, long-task total ("TBT proxy"), JS/image/total bytes,
 *   DOM nodes, and click -> next paint latency for a real interaction.
 * Writes data/perf/browser-<label>.json and prints a summary table.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const base = arg('--base', process.env.PERF_BASE || 'http://127.0.0.1:4327');
const label = arg('--label', 'run');
const outDir = arg('--out', 'data/perf');
const adminPassword = arg('--password', process.env.ADMIN_PASSWORD || 'admin');
const passes = Number(arg('--passes', '2'));

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',
    process.env.PLAYWRIGHT_PATH,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      return mod.chromium ? mod : mod.default;
    } catch {
      /* try the next candidate */
    }
  }

  throw new Error(
    'playwright-core was not found. Set PLAYWRIGHT_CORE_PATH to its index.mjs (see the header of this file).',
  );
}

const INIT_SCRIPT = () => {
  window.__perf = { lcp: 0, cls: 0, longTasks: 0, fcp: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perf.lcp = Math.max(window.__perf.lcp, entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__perf.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perf.longTasks += Math.max(0, entry.duration - 50);
      }
    }).observe({ type: 'longtask', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') window.__perf.fcp = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch {
    /* observers unsupported */
  }
};

function collector() {
  const bytes = { total: 0, script: 0, image: 0, css: 0, font: 0, document: 0 };
  return {
    bytes,
    onResponse(response) {
      const request = response.request();
      if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') return;
      const length = Number(response.headers()['content-length'] || 0);
      const size = Number.isFinite(length) && length > 0 ? length : 0;
      bytes.total += size;
      const type = request.resourceType();
      if (type === 'script') bytes.script += size;
      else if (type === 'image') bytes.image += size;
      else if (type === 'stylesheet') bytes.css += size;
      else if (type === 'font') bytes.font += size;
      else if (type === 'document') bytes.document += size;
    },
  };
}

async function measureRoute(page, url, clickSelector, clickLabel) {
  const net = collector();
  page.on('response', net.onResponse);
  await page.addInitScript(INIT_SCRIPT);

  const startedAt = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  const loadMs = Date.now() - startedAt;

  // Let LCP/CLS/long tasks settle (fonts, deferred chunks, transitions).
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      ttfb: nav ? nav.responseStart : 0,
      fcp: window.__perf?.fcp ?? 0,
      lcp: window.__perf?.lcp ?? 0,
      cls: window.__perf?.cls ?? 0,
      longTasks: window.__perf?.longTasks ?? 0,
      domNodes: document.getElementsByTagName('*').length,
    };
  });

  let clickMs = null;
  if (clickSelector) {
    const exists = await page.locator(clickSelector).first().count();
    if (exists > 0) {
      clickMs = await page.evaluate(async (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const t0 = performance.now();
        el.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - t0;
      }, clickSelector);
      // Let any view transition / client filtering finish before the next route.
      await page.waitForTimeout(600);
    }
  }

  page.off('response', net.onResponse);
  return {
    url,
    status: 200,
    loadMs,
    ...metrics,
    clickLabel: clickLabel ?? null,
    clickMs,
    bytes: net.bytes,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(runs) {
  const pick = (key) => Math.round(median(runs.map((run) => run[key] ?? 0)) * 10) / 10;
  return {
    ttfb: pick('ttfb'),
    fcp: pick('fcp'),
    lcp: pick('lcp'),
    cls: Math.round(median(runs.map((run) => run.cls)) * 1000) / 1000,
    longTasks: pick('longTasks'),
    domNodes: Math.round(median(runs.map((run) => run.domNodes))),
    loadMs: Math.round(median(runs.map((run) => run.loadMs))),
    clickMs: runs[0].clickMs === null ? null : pick('clickMs'),
    bytes: {
      total: Math.round(median(runs.map((run) => run.bytes.total))),
      script: Math.round(median(runs.map((run) => run.bytes.script))),
      image: Math.round(median(runs.map((run) => run.bytes.image))),
      css: Math.round(median(runs.map((run) => run.bytes.css))),
    },
  };
}

const ROUTES = [
  { path: '/', click: 'a[href="/gallery"]', clickLabel: 'header nav -> gallery' },
  { path: '/mandaps', click: '.filter-bar a.filter-btn:nth-of-type(2)', clickLabel: 'mandap category filter' },
  { path: '/gallery', click: '.filter-bar a.filter-btn:nth-of-type(2)', clickLabel: 'gallery category filter' },
  { path: '/catering' },
  { path: '/equipment', click: 'a[href*="?category="]', clickLabel: 'equipment category' },
  { path: '/contact' },
];

const { chromium } = await loadPlaywright();
const cachedChromium = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(cachedChromium) ? cachedChromium : undefined);

const browser = await chromium.launch({ headless: true, executablePath });

const results = { label, base, generatedAt: new Date().toISOString(), desktop: {}, mobile: {}, admin: {} };

async function runProfile(profile, contextOptions, routes, throttle) {
  const context = await browser.newContext(contextOptions);

  if (profile === 'admin') {
    const page = await context.newPage();
    const login = await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
    if (login && login.status() < 400) {
      await page.fill('input[name="username"]', 'admin');
      await page.fill('input[name="password"]', adminPassword);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), page.click('button[type="submit"]')]);
    }
    await page.close();
  }

  for (const route of routes) {
    const runs = [];
    for (let pass = 0; pass < passes + 1; pass += 1) {
      const page = await context.newPage();
      if (throttle) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      }
      const result = await measureRoute(page, `${base}${route.path}`, route.click, route.clickLabel);
      await page.close();
      if (pass > 0) runs.push(result); // first pass is warm-up only
    }
    results[profile][route.path] = { ...summarize(runs), runs };
  }

  await context.close();
}

await runProfile('desktop', { viewport: { width: 1280, height: 900 } }, ROUTES, 0);
await runProfile(
  'mobile',
  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  ROUTES,
  4,
);
await runProfile('admin', { viewport: { width: 1440, height: 900 } }, [
  { path: '/admin', click: 'a[href="/admin/content"]', clickLabel: 'admin dashboard -> content' },
], 0);

await browser.close();

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `browser-${label}-${Date.now()}.json`);
writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

const row = (profile, route, data) =>
  `${profile.padEnd(8)} ${route.padEnd(14)} ttfb ${String(data.ttfb).padStart(6)}ms  fcp ${String(data.fcp).padStart(6)}ms  lcp ${String(data.lcp).padStart(6)}ms  cls ${String(data.cls).padStart(5)}  tbt ${String(data.longTasks).padStart(6)}ms  js ${Math.round(data.bytes.script / 1024)}kB  total ${Math.round(data.bytes.total / 1024)}kB  click ${data.clickMs === null ? '—' : `${Math.round(data.clickMs)}ms`}`;

console.log(`\n[browser-perf] ${label} @ ${base}`);
for (const profile of ['desktop', 'mobile', 'admin']) {
  for (const [route, data] of Object.entries(results[profile])) {
    console.log(row(profile, route, data));
  }
}
console.log(`[browser-perf] wrote ${outFile}`);
