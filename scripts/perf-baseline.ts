/**
 * Performance baseline harness.
 *
 * Usage:
 *   npm run perf:baseline -- --base http://localhost:4321 --label before
 *
 * Logs into the admin console (when credentials allow), then measures TTFB,
 * total duration, payload size and Server-Timing breakdown for the main public
 * and admin routes. Writes a JSON report to data/perf/<label>-<timestamp>.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface MeasureEntry {
  group: 'public' | 'admin' | 'media';
  path: string;
  status: number;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  contentType: string;
  serverTiming: Record<string, number>;
  queries: number | null;
  dbMs: number | null;
  error?: string;
}

class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name) continue;
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(raw)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

function parseArgs(): { base: string; label: string; outDir: string; password: string; anonymous: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  return {
    base: get('--base', process.env.PERF_BASE || 'http://localhost:4321'),
    label: get('--label', 'run'),
    outDir: get('--out', 'data/perf'),
    password: get('--password', process.env.ADMIN_PASSWORD || 'admin'),
    anonymous: args.includes('--anonymous'),
  };
}

function parseServerTiming(header: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  if (!header) return result;
  for (const part of header.split(',')) {
    const [name, ...rest] = part.trim().split(';');
    for (const token of rest) {
      const match = token.trim().match(/^dur=([\d.]+)$/);
      if (match) result[name.trim()] = Number(match[1]);
    }
  }
  return result;
}

async function measure(url: string, jar: CookieJar | null): Promise<MeasureEntry> {
  const startedAt = performance.now();
  const entry: MeasureEntry = {
    group: 'public',
    path: url.replace(/^https?:\/\/[^/]+/, ''),
    status: 0,
    ttfbMs: 0,
    totalMs: 0,
    bytes: 0,
    contentType: '',
    serverTiming: {},
    queries: null,
    dbMs: null,
  };

  try {
    const cookieHeader = jar?.header();
    const response = await fetch(url, {
      redirect: 'manual',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      signal: AbortSignal.timeout(30000),
    });
    entry.ttfbMs = performance.now() - startedAt;
    jar?.absorb(response);

    const body = await response.arrayBuffer();
    entry.totalMs = performance.now() - startedAt;
    entry.status = response.status;
    entry.bytes = body.byteLength;
    entry.contentType = response.headers.get('content-type') || '';
    entry.serverTiming = parseServerTiming(response.headers.get('server-timing'));
    entry.queries = entry.serverTiming.db !== undefined ? Number(response.headers.get('server-timing')?.match(/desc="(\d+)q"/)?.[1] ?? 0) : null;
    entry.dbMs = entry.serverTiming.db ?? null;
    entry.error = response.status >= 400 ? `HTTP ${response.status}` : undefined;
  } catch (error) {
    entry.totalMs = performance.now() - startedAt;
    entry.error = error instanceof Error ? error.message : String(error);
  }

  return entry;
}

async function fetchHtml(url: string, jar: CookieJar): Promise<string> {
  const response = await fetch(url, {
    headers: { cookie: jar.header() },
    signal: AbortSignal.timeout(30000),
  });
  jar.absorb(response);
  return response.text();
}

function extractFirst(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1] : null;
}

function summarize(entries: MeasureEntry[]): string {
  const lines: string[] = [];
  lines.push('path'.padEnd(44) + 'status'.padEnd(8) + 'TTFB'.padEnd(10) + 'total'.padEnd(10) + 'KB'.padEnd(9) + 'q'.padEnd(5) + 'db ms');
  lines.push('-'.repeat(96));
  for (const entry of [...entries].sort((a, b) => b.ttfbMs - a.ttfbMs)) {
    lines.push(
      entry.path.padEnd(44) +
        String(entry.status).padEnd(8) +
        `${entry.ttfbMs.toFixed(0)}ms`.padEnd(10) +
        `${entry.totalMs.toFixed(0)}ms`.padEnd(10) +
        (entry.bytes / 1024).toFixed(0).padEnd(9) +
        String(entry.queries ?? '-').padEnd(5) +
        (entry.dbMs === null ? '-' : entry.dbMs.toFixed(0)),
    );
  }
  return lines.join('\n');
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main(): Promise<void> {
  const { base, label, outDir, anonymous } = parseArgs();
  const jar = new CookieJar();

  console.log(`[perf] baseline ${label} against ${base}${anonymous ? ' (anonymous)' : ''}`);

  // Warm up + authenticate.
  let authenticated = false;
  if (!anonymous) {
    await measure(`${base}/admin/login`, jar);
    const loginHtml = await fetchHtml(`${base}/admin/login`, jar);
    const csrf = extractFirst(loginHtml, /name="_csrf"\s+value="([^"]+)"/);
    const { password } = parseArgs();

    if (csrf) {
      const response = await fetch(`${base}/admin/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
        body: new URLSearchParams({ _csrf: csrf, username: 'admin', password, next: '/admin' }).toString(),
        signal: AbortSignal.timeout(30000),
      });
      jar.absorb(response);
      authenticated = response.status === 303 || response.status === 302;
      console.log(`[perf] admin login -> ${response.status}${authenticated ? ' (session established)' : ' (session NOT established — admin routes may redirect)'}`);
    } else {
      console.log('[perf] could not extract CSRF token — measuring admin routes anonymously');
    }
  }

  // Discover real slugs from listing pages.
  const slugs: Record<string, string | null> = { mandap: null, stage: null, hall: null, catering: null };
  try {
    const [mandapsHtml, stagesHtml, hallsHtml, cateringHtml] = await Promise.all([
      fetchHtml(`${base}/mandaps`, jar),
      fetchHtml(`${base}/stages`, jar),
      fetchHtml(`${base}/halls`, jar),
      fetchHtml(`${base}/catering`, jar),
    ]);
    slugs.mandap = extractFirst(mandapsHtml, /href="\/mandaps\/([a-z0-9-]+)"/i);
    slugs.stage = extractFirst(stagesHtml, /href="\/stages\/([a-z0-9-]+)"/i);
    slugs.hall = extractFirst(hallsHtml, /href="\/halls\/([a-z0-9-]+)"/i);
    slugs.catering = extractFirst(cateringHtml, /href="\/catering\/([a-z0-9-]+)"/i);
  } catch (error) {
    console.warn('[perf] slug discovery failed:', error instanceof Error ? error.message : error);
  }

  const publicRoutes = [
    '/',
    '/mandaps',
    slugs.mandap ? `/mandaps/${slugs.mandap}` : null,
    '/stages',
    slugs.stage ? `/stages/${slugs.stage}` : null,
    '/equipment',
    '/gallery',
    '/catering',
    slugs.catering ? `/catering/${slugs.catering}` : null,
    '/halls',
    slugs.hall ? `/halls/${slugs.hall}` : null,
    '/contact',
    '/plan',
    '/terms',
  ].filter((route): route is string => Boolean(route));

  const adminRoutes = anonymous
    ? []
    : [
        '/admin',
        '/admin/bookings',
        '/admin/payments',
        '/admin/enquiries',
        '/admin/customers',
        '/admin/inquiries',
        '/admin/halls',
        '/admin/catering',
        '/admin/gallery',
        '/admin/content',
      ];

  // Warm-up pass (module graph + caches), then the measured pass.
  for (const route of [...publicRoutes, ...adminRoutes]) {
    await measure(`${base}${route}`, jar);
  }

  const entries: MeasureEntry[] = [];
  for (const route of publicRoutes) {
    const entry = await measure(`${base}${route}`, jar);
    entry.group = 'public';
    entries.push(entry);
  }
  for (const route of adminRoutes) {
    const entry = await measure(`${base}${route}`, jar);
    entry.group = 'admin';
    entries.push(entry);
  }

  // Media samples straight from the homepage.
  try {
    const homeHtml = await fetchHtml(`${base}/`, jar);
    const imagePath = extractFirst(homeHtml, /src="(\/storage\/[^"?#]+)"/);
    if (imagePath) {
      const original = await measure(`${base}${imagePath}`, jar);
      original.group = 'media';
      original.path = `${imagePath} (original)`;
      entries.push(original);

      const resized = await measure(`${base}${imagePath}?w=400`, jar);
      resized.group = 'media';
      resized.path = `${imagePath}?w=400`;
      entries.push(resized);
    }
  } catch (error) {
    console.warn('[perf] media sampling failed:', error instanceof Error ? error.message : error);
  }

  console.log('\n' + summarize(entries) + '\n');

  const publicTtfb = entries.filter((e) => e.group === 'public' && !e.error).map((e) => e.ttfbMs);
  const adminTtfb = entries.filter((e) => e.group === 'admin').map((e) => e.ttfbMs);
  const summary = {
    public: {
      count: publicTtfb.length,
      medianTtfb: percentile(publicTtfb, 50),
      p95Ttfb: percentile(publicTtfb, 95),
      maxTtfb: publicTtfb.length ? Math.max(...publicTtfb) : 0,
    },
    admin: {
      count: adminTtfb.length,
      medianTtfb: percentile(adminTtfb, 50),
      p95Ttfb: percentile(adminTtfb, 95),
      maxTtfb: adminTtfb.length ? Math.max(...adminTtfb) : 0,
    },
    totalQueries: entries.reduce((sum, e) => sum + (e.queries ?? 0), 0),
    totalDbMs: entries.reduce((sum, e) => sum + (e.dbMs ?? 0), 0),
  };

  console.log(
    `[perf] public TTFB p50=${summary.public.medianTtfb.toFixed(0)}ms p95=${summary.public.p95Ttfb.toFixed(0)}ms | ` +
      `admin TTFB p50=${summary.admin.medianTtfb.toFixed(0)}ms p95=${summary.admin.p95Ttfb.toFixed(0)}ms`,
  );

  const dir = resolve(process.cwd(), outDir);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${label}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ label, base, at: new Date().toISOString(), authenticated, entries, summary }, null, 2));
  console.log(`[perf] wrote ${outPath}`);
}

main().catch((error) => {
  console.error('[perf] failed:', error);
  process.exit(1);
});
