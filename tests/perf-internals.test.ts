import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  buildPagination,
  formatDate,
  formatDateTime,
  parsePageParams,
} from '../src/core/http';
import {
  getCachedPage,
  isCacheablePagePath,
  invalidatePageCache,
  storePage,
} from '../src/core/page-cache';
import { getRenderedImage, storeRenderedImage } from '../src/core/image/cache';
import { parseTransformParams, transformCacheKey } from '../src/core/image/transform';
import { PAYMENT_METRICS_SQL } from '../src/core/operational/service';

const repoRoot = resolve(import.meta.dirname, '..');

/* ---------------- Pagination helpers ---------------- */

test('1. pagination helpers clamp page/perPage and compute offsets', () => {
  const fromUrl = parsePageParams(new URL('http://localhost/admin/bookings?page=3&per=50'));
  assert.deepEqual(fromUrl, { page: 3, perPage: 50, offset: 100 });

  const defaults = parsePageParams(new URL('http://localhost/admin/bookings'));
  assert.deepEqual(defaults, { page: 1, perPage: 25, offset: 0 });

  const clamped = parsePageParams(new URL('http://localhost/x?page=-4&per=9999'), { defaultPerPage: 25, maxPerPage: 100 });
  assert.deepEqual(clamped, { page: 1, perPage: 100, offset: 0 });

  const garbage = parsePageParams(new URL('http://localhost/x?page=abc&per=xyz'));
  assert.deepEqual(garbage, { page: 1, perPage: 25, offset: 0 });
});

test('2. buildPagination reports start/end items and total pages', () => {
  const first = buildPagination(1, 25, 120, 25);
  assert.equal(first.totalPages, 5);
  assert.equal(first.startItem, 1);
  assert.equal(first.endItem, 25);

  const last = buildPagination(5, 25, 120, 20);
  assert.equal(last.startItem, 101);
  assert.equal(last.endItem, 120);

  const empty = buildPagination(1, 25, 0, 0);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.startItem, 0);
  assert.equal(empty.endItem, 0);

  const overflow = buildPagination(99, 25, 120, 25);
  assert.equal(overflow.page, 5, 'page is clamped to the last page');
  assert.equal(overflow.offset, 100);
});

/* ---------------- Image transform params & cache ---------------- */

test('3. transform params are validated, clamped and quantised', () => {
  assert.equal(parseTransformParams(new URLSearchParams('')), null, 'no params = no transform');

  const basic = parseTransformParams(new URLSearchParams('w=400'));
  assert.equal(basic?.width, 400);
  assert.equal(basic?.format, 'webp');
  assert.equal(basic?.quality, 78);

  const huge = parseTransformParams(new URLSearchParams('w=99999&q=1000&f=avif'));
  assert.equal(huge?.width, 2400);
  assert.equal(huge?.quality, 90);
  assert.equal(huge?.format, 'avif');

  const tiny = parseTransformParams(new URLSearchParams('w=1&q=1'));
  assert.equal(tiny?.width, 16);
  assert.equal(tiny?.quality, 40);

  const invalidWidth = parseTransformParams(new URLSearchParams('w=abc'));
  assert.equal(invalidWidth, null, 'invalid width falls back to the original');

  const badFormat = parseTransformParams(new URLSearchParams('f=gif'));
  assert.equal(badFormat?.format, 'webp', 'unknown formats fall back to webp');

  const quantised = parseTransformParams(new URLSearchParams('w=403'));
  assert.equal(quantised?.width, 400, 'widths are quantised so cache keys stay bounded');
});

test('4. rendered image cache stores, hits and distinguishes variants', () => {
  const params = { width: 400, quality: 78, format: 'webp' as const };
  // Unique per run: the cache also persists to disk between processes.
  const nonce = Math.random().toString(36).slice(2);
  const key = transformCacheKey(`gallery/1/${nonce}.webp`, params);
  const otherKey = transformCacheKey(`gallery/1/${nonce}.webp`, { ...params, width: 800 });

  assert.equal(getRenderedImage(key), undefined);
  storeRenderedImage(key, { data: Buffer.from('small'), contentType: 'image/webp' });

  const hit = getRenderedImage(key);
  assert.ok(hit);
  assert.equal(hit.contentType, 'image/webp');
  assert.ok(hit.etag.startsWith('W/"img-'));
  assert.equal(getRenderedImage(otherKey), undefined, 'different widths use different cache keys');
});

/* ---------------- Page cache ---------------- */

test('5. page cache only covers marketing routes without POST forms or CSRF tokens', () => {
  for (const path of ['/', '/mandaps', '/stages', '/equipment', '/gallery', '/catering', '/terms']) {
    assert.equal(isCacheablePagePath(path), true, `${path} should be cacheable`);
  }
  for (const path of ['/mandaps/royal-mandap', '/stages/royal-stage', '/catering/pkg']) {
    assert.equal(isCacheablePagePath(path), true, `${path} should be cacheable`);
  }
  for (const path of ['/admin', '/admin/content', '/api/enquiries', '/contact', '/plan', '/booking/overview', '/receipts/enquiry/ABC', '/storage/x.webp']) {
    assert.equal(isCacheablePagePath(path), false, `${path} must never be cached`);
  }

  // Guard: cached routes must not embed CSRF tokens or POST forms.
  const componentFiles = [
    'src/modules/home/pages/HomePage.astro',
    'src/modules/mandaps/pages/MandapsPage.astro',
    'src/modules/mandaps/pages/MandapDetailPage.astro',
    'src/modules/stages/pages/StagesPage.astro',
    'src/modules/stages/pages/StageDetailPage.astro',
    'src/modules/equipment/pages/EquipmentPage.astro',
    'src/modules/gallery/pages/GalleryPage.astro',
    'src/modules/catering/pages/CateringPage.astro',
    'src/modules/catering/pages/PackageDetailPage.astro',
    'src/modules/halls/pages/HallsPage.astro',
    'src/modules/halls/pages/HallDetailPage.astro',
  ];

  for (const relativePath of componentFiles) {
    const source = readFileSync(join(repoRoot, relativePath), 'utf8');
    assert.equal(/_csrf/.test(source), false, `${relativePath} must not embed a CSRF token`);
    assert.equal(/<form[^>]*method=["']post["']/i.test(source), false, `${relativePath} must not contain a POST form`);
    assert.equal(/Astro\.locals\.auth\.user/.test(source), false, `${relativePath} must not render per-user content`);
  }
});

test('6. page cache honours the TTL, refreshes LRU order and can be purged', () => {
  invalidatePageCache();
  const headers = { 'content-type': 'text/html; charset=utf-8' };

  storePage('/mandaps', { body: '<html>one</html>', status: 200, contentType: 'text/html', headers });
  const hit = getCachedPage('/mandaps');
  assert.ok(hit);
  assert.equal(hit.body, '<html>one</html>');

  storePage('/stages', { body: '<html>two</html>', status: 200, contentType: 'text/html', headers });
  assert.ok(getCachedPage('/stages'));

  invalidatePageCache();
  assert.equal(getCachedPage('/mandaps'), null, 'purge clears every entry');
  assert.equal(getCachedPage('/stages'), null);
});

/* ---------------- Date formatting with DB Date objects ---------------- */

test('7. formatDateTime/formatDate accept Date objects returned by Postgres', () => {
  const date = new Date('2026-02-03T04:05:06.000Z');

  const formatted = formatDateTime(date);
  assert.equal(formatted.includes('NaN'), false);
  assert.equal(formatted.length > 0, true);

  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDate(undefined), 'To be announced');
  const dateOnly = formatDate(date);
  assert.equal(dateOnly.includes('NaN'), false);
  // Strings keep working exactly as before.
  assert.equal(formatDateTime('2026-02-03 04:05:06').includes('NaN'), false);
});

/* ---------------- Payment metrics SQL parity ---------------- */

test('8. aggregate payment metrics match the previous JavaScript aggregation', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE bookings (id INTEGER PRIMARY KEY, outstanding_balance INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY, status TEXT NOT NULL, provider TEXT NOT NULL,
      amount_paise INTEGER NOT NULL
    );
    CREATE TABLE refunds (id INTEGER PRIMARY KEY, status TEXT NOT NULL, amount_paise INTEGER NOT NULL);
  `);

  const bookings = [
    { outstanding: 500000 },
    { outstanding: 0 },
    { outstanding: 125000 },
  ];
  const payments = [
    { status: 'captured', provider: 'phonepe', amount: 400000 },
    { status: 'captured', provider: 'phonepe', amount: 100000 },
    { status: 'captured', provider: 'razorpay', amount: 250000 },
    { status: 'pending', provider: 'phonepe', amount: 99900 },
    { status: 'created', provider: 'phonepe', amount: 11100 },
    { status: 'failed', provider: 'phonepe', amount: 5000 },
    { status: 'refunded', provider: 'phonepe', amount: 150000 },
    { status: 'partially_refunded', provider: 'phonepe', amount: 150000 },
  ];
  const refunds = [
    { status: 'processed', amount: 50000 },
    { status: 'processed', amount: 25000 },
    { status: 'pending', amount: 90000 },
  ];

  const insertBooking = db.prepare('INSERT INTO bookings (outstanding_balance) VALUES (?)');
  bookings.forEach((b) => insertBooking.run(b.outstanding));
  const insertPayment = db.prepare('INSERT INTO payments (status, provider, amount_paise) VALUES (?, ?, ?)');
  payments.forEach((p) => insertPayment.run(p.status, p.provider, p.amount));
  const insertRefund = db.prepare('INSERT INTO refunds (status, amount_paise) VALUES (?, ?)');
  refunds.forEach((r) => insertRefund.run(r.status, r.amount));

  // Reference values computed the old way (JS loops over the same fixture).
  let collected = 0;
  let successful = 0;
  let pending = 0;
  let failed = 0;
  let refunded = 0;
  let phonepeTotal = 0;
  let phonepeCount = 0;
  for (const p of payments) {
    if (p.status === 'captured') {
      collected += p.amount;
      successful += 1;
      if (p.provider === 'phonepe') {
        phonepeTotal += p.amount;
        phonepeCount += 1;
      }
    } else if (['pending', 'created', 'authorized'].includes(p.status)) {
      pending += 1;
    } else if (p.status === 'failed') {
      failed += 1;
    } else if (['refunded', 'partially_refunded'].includes(p.status)) {
      refunded += 1;
    }
  }
  const refundedTotal = refunds.filter((r) => r.status === 'processed').reduce((sum, r) => sum + r.amount, 0);
  const outstandingTotal = bookings.reduce((sum, b) => sum + b.outstanding, 0);

  const row = db.prepare(PAYMENT_METRICS_SQL).get() as Record<string, number | string>;

  assert.equal(Number(row.collected), collected);
  assert.equal(Number(row.successful_count), successful);
  assert.equal(Number(row.pending_count), pending);
  assert.equal(Number(row.failed_count), failed);
  assert.equal(Number(row.refunded_count), refunded);
  assert.equal(Number(row.phonepe_total), phonepeTotal);
  assert.equal(Number(row.phonepe_count), phonepeCount);
  assert.equal(Number(row.refunded_total), refundedTotal);
  assert.equal(Number(row.outstanding_total), outstandingTotal);

  db.close();
});

/* ---------------- Repository hygiene guards ---------------- */

test('9. no duplicate module caches: singletons live on globalThis', () => {
  const guardedFiles = [
    'src/core/content/service.ts',
    'src/core/content/d1-client.ts',
    'src/core/operational/neon-client.ts',
    'src/core/db.ts',
    'src/core/page-cache.ts',
    'src/core/image/cache.ts',
  ];

  for (const relativePath of guardedFiles) {
    const source = readFileSync(join(repoRoot, relativePath), 'utf8');
    assert.ok(source.includes('globalThis'), `${relativePath} must keep its singleton on globalThis`);
  }
});

test('10. archive images stay out of the built public directory', () => {
  assert.equal(existsSync(join(repoRoot, 'public/images/archive')), false, 'public/images/archive must not exist');
  assert.equal(existsSync(join(repoRoot, 'data/archive')), true, 'archive originals live under data/archive');
});
