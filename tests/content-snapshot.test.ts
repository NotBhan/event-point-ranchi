import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { PublicContentRows } from '../src/core/content/snapshot-types';

const {
  SnapshotValidationError,
  buildManifest,
  buildSnapshot,
  computeContentVersion,
  fetchPublicContentRows,
  validateSnapshotData,
} = await import('../src/core/content/snapshot-builder');
const { resolveSyncConfig, syncContent } = await import('../scripts/sync-content');
const { buildReport, reportPublication, resolveReportConfig } = await import('../scripts/report-publish');
const { snapshotStaticPaths, staticPathsForSlugs } = await import('../src/core/content/static-paths');

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-snapshot-test-'));

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function validRows(overrides: Partial<PublicContentRows> = {}): PublicContentRows {
  return {
    settings: {
      id: 'global',
      name: 'Event Point Ranchi',
      legal_name: 'Event Point',
      tagline: 'Tagline',
      short_description: 'Short',
      logo_url: '',
      favicon_url: '',
      phone: '+91 98765 43210',
      whatsapp: '919876543210',
      email: 'info@eventpoint.test',
      address: 'Main Road, Ranchi',
      venue_address: 'Venue',
      business_hours: 'Daily',
      social_links_json: '[]',
      primary_color: '#721224',
      gold_bright: '#e0b868',
      font_preset: 'heritage',
      default_title: 'Event Point',
      default_description: 'Description',
      og_image_url: '',
      currency: 'INR',
      locale: 'en-IN',
      announcement_enabled: 1,
      announcement_text: '',
      announcement_location: '',
      announcement_phone: '',
      google_maps_url: '',
      latitude: 23.3,
      longitude: 85.3,
      footer_text: '',
      contact_buttons_enabled: 1,
      maintenance_enabled: 0,
      maintenance_message: '',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    pages: ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'].map((page_key, index) => ({
      id: index + 1,
      page_key,
      title: `${page_key} title`,
      subtitle: '',
      description: '',
      banner_image_url: '',
      banner_enabled: 1,
      content_json: '{"badge":"Signature"}',
      seo_title: '',
      seo_description: '',
      og_image_url: '',
      published: 1,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    })),
    seo: [],
    homeSections: [{ id: 'hero', section_key: 'hero', section_type: 'hero', title: 'Hero', subtitle: 'Sub', description: '', image_url: '', cta_label: 'Go', cta_url: '/mandaps', badge: '', is_visible: 1, sort_order: 0, config_json: '{}', created_at: '', updated_at: '' }],
    services: [],
    mandaps: [
      {
        id: 1,
        name: 'Royal Mandap',
        slug: 'royal-mandap',
        description: '',
        category: 'Traditional Royal',
        length_ft: 16,
        width_ft: 16,
        height_ft: 12,
        dimension_unit: 'ft',
        material_specs: '',
        price_starting_paise: 0,
        capacity: 0,
        features_json: '["Carved pillars"]',
        image_url: '/storage/mandap.webp',
        location_name: '',
        address: '',
        latitude: null,
        longitude: null,
        google_maps_url: '',
        directions_url: '',
        show_location: 0,
        is_featured: 1,
        is_visible: 1,
        sort_order: 0,
      },
    ],
    mandapGallery: [{ id: 1, mandap_id: 1, image_url: '/storage/mandap-1.webp', caption: '', sort_order: 0 }],
    stages: [
      {
        id: 2,
        name: 'Royal Stage',
        slug: 'royal-stage',
        description: '',
        style_category: 'Royal Reception',
        length_ft: 24,
        width_ft: 16,
        height_ft: 14,
        dimension_unit: 'ft',
        decoration_notes: '',
        price_starting_paise: 0,
        image_url: '/storage/stage.webp',
        is_featured: 0,
        is_visible: 1,
        sort_order: 0,
      },
    ],
    stageGallery: [{ id: 2, stage_id: 2, image_url: '/storage/stage-1.webp', caption: '', sort_order: 0 }],
    furnitureCategories: [{ id: 4, name: 'Chairs', slug: 'chairs', icon: 'chair', sort_order: 0, is_visible: 1 }],
    furnitureItems: [
      {
        id: 5,
        category_id: 4,
        name: 'Golden Chiavari Chair',
        slug: 'golden-chiavari-chair',
        description: '',
        image_url: '',
        price_paise: 25000,
        pricing_unit: 'per item',
        dimensions: '',
        specifications: '',
        min_quantity: 1,
        default_quantity: 10,
        is_visible: 1,
        sort_order: 0,
      },
    ],
    cateringPackages: [
      {
        id: 6,
        name: 'Silver',
        slug: 'silver',
        description: '',
        badge: '',
        image_url: '',
        price_per_plate_paise: 50000,
        features_json: '["Starter","Dessert"]',
        menu_sections_json: '[{"title":"Welcome"}]',
        guest_pricing_json: '[]',
        show_on_home: 1,
        is_visible: 1,
        sort_order: 0,
      },
    ],
    galleryCategories: [{ id: 7, name: 'Mandap Designs', slug: 'mandap-designs', sort_order: 0, is_visible: 1 }],
    galleryItems: [{ id: 8, category_id: 7, caption: 'Mandap', image_url: '/storage/gallery-1.webp', alt_text: '', is_visible: 1, sort_order: 0, created_at: '' }],
    videos: [
      {
        id: 9,
        title: 'Walkthrough',
        description: '',
        platform: 'youtube',
        video_url: 'https://youtube.com/watch?v=abc',
        video_id: 'abc',
        thumbnail_url: '',
        aspect_ratio: '16:9',
        is_featured: 1,
        is_published: 1,
        sort_order: 0,
        created_at: '',
        updated_at: '',
      },
    ],
    ...overrides,
  };
}

test('only published and visible rows are requested from D1', async () => {
  const statements: string[] = [];
  const fetcher = {
    async batch<T>(input: Array<{ sql: string }>): Promise<Array<{ results: T[] }>> {
      for (const statement of input) statements.push(statement.sql);
      return input.map(() => ({ results: [] as T[] }));
    },
  };

  await fetchPublicContentRows(fetcher as never);

  const joined = statements.join('\n');
  assert.match(joined, /page_content WHERE published = 1/);
  assert.match(joined, /services WHERE is_visible = 1/);
  assert.match(joined, /mandaps WHERE is_visible = 1/);
  assert.match(joined, /stages WHERE is_visible = 1/);
  assert.match(joined, /furniture_items WHERE is_visible = 1/);
  assert.match(joined, /gallery_items WHERE is_visible = 1/);
  assert.match(joined, /video_previews WHERE is_published = 1/);
  assert.equal(statements.length, 15, 'all public tables come from one batch');
});

test('builds a valid snapshot and a stable content version', () => {
  const snapshot = buildSnapshot(validRows());
  validateSnapshotData(snapshot);

  assert.equal(snapshot.mandaps.length, 1);
  assert.deepEqual(snapshot.mandaps[0].features, ['Carved pillars']);
  assert.deepEqual(snapshot.cateringPackages[0].features, ['Starter', 'Dessert']);
  assert.deepEqual(snapshot.cateringPackages[0].menu_sections, [{ title: 'Welcome' }]);
  assert.equal(snapshot.galleryItems[0].category_slug, 'mandap-designs');
  assert.deepEqual(snapshot.pages.find((page) => page.page_key === 'home')?.content_json, { badge: 'Signature' });

  const manifest = buildManifest(snapshot, '2026-05-01T00:00:00.000Z');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.counts.mandaps, 1);
  assert.equal(manifest.counts.furnitureItems, 1);
  assert.equal(manifest.generatedAt, '2026-05-01T00:00:00.000Z');
  assert.equal(manifest.contentVersion, computeContentVersion(snapshot));
  assert.equal(manifest.contentVersion, buildManifest(buildSnapshot(validRows())).contentVersion);

  const changed = buildSnapshot(
    validRows({
      mandaps: [...validRows().mandaps, { ...validRows().mandaps[0], id: 99, slug: 'second-mandap' }],
    }),
  );
  assert.notEqual(computeContentVersion(changed), manifest.contentVersion);
});

test('never copies private fields into the snapshot', () => {
  const rows = validRows();
  rows.settings = { ...rows.settings, password_hash: 'secret', customer_name: 'Private Person' };
  rows.mandaps = [{ ...rows.mandaps[0], booking_reference: 'EP-123', payment_id: 'pay_1' }];

  const snapshot = buildSnapshot(rows);
  const serialized = JSON.stringify(snapshot);

  for (const forbidden of ['password', 'customer_name', 'Private Person', 'booking', 'payment', 'pay_1', 'EP-123']) {
    assert.equal(serialized.includes(forbidden), false, `snapshot must not contain ${forbidden}`);
  }
});

test('rejects incomplete or inconsistent content', () => {
  const noSettings = buildSnapshot(validRows({ settings: null }));
  assert.throws(() => validateSnapshotData(noSettings), SnapshotValidationError);

  const noMandaps = buildSnapshot(validRows({ mandaps: [], mandapGallery: [] }));
  assert.throws(() => validateSnapshotData(noMandaps), /no visible mandaps/);

  const missingPage = buildSnapshot(validRows({ pages: validRows().pages.filter((page) => page.page_key !== 'gallery') }));
  assert.throws(() => validateSnapshotData(missingPage), /published page "gallery" is missing/);

  const duplicateSlug = buildSnapshot(
    validRows({ stages: [...validRows().stages, { ...validRows().stages[0], id: 77 }] }),
  );
  assert.throws(() => validateSnapshotData(duplicateSlug), /duplicate slug "royal-stage"/);

  const danglingCategory = buildSnapshot(
    validRows({ galleryItems: [{ ...validRows().galleryItems[0], category_id: 999 }] }),
  );
  assert.throws(() => validateSnapshotData(danglingCategory), /references a missing category/);

  const unsafeSlug = buildSnapshot(validRows({ furnitureCategories: [{ ...validRows().furnitureCategories[0], slug: '../evil' }] }));
  assert.throws(() => validateSnapshotData(unsafeSlug), /unsafe slug/);
});

test('resolveSyncConfig reports missing credentials and resolves configured ones', () => {
  const missing = resolveSyncConfig({});
  assert.deepEqual(missing.missing, [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_DATABASE_ID',
    'CLOUDFLARE_API_TOKEN',
  ]);
  assert.equal(missing.config, null);

  const resolved = resolveSyncConfig({
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    CLOUDFLARE_DATABASE_ID: 'db',
    CLOUDFLARE_API_TOKEN: 'token',
    CONTENT_SNAPSHOT_DIR: join(tempRoot, 'configured'),
  });
  assert.equal(resolved.missing.length, 0);
  assert.equal(resolved.config?.accountId, 'acc');
  assert.equal(resolved.config?.outputDir, join(tempRoot, 'configured'));
});

test('a failing D1 fetch writes nothing and preserves the previous snapshot', async () => {
  const outputDir = mkdtempSync(join(tempRoot, 'fail-'));
  const previous = JSON.stringify({ previous: true });
  writeFileSync(join(outputDir, 'public-content.json'), previous);

  await assert.rejects(
    syncContent({
      fetcher: {
        async batch<T>(): Promise<Array<{ results: T[] }>> {
          throw new Error('network unavailable');
        },
      },
      outputDir,
    }),
    /network unavailable/,
  );

  assert.equal(readFileSync(join(outputDir, 'public-content.json'), 'utf8'), previous);
  assert.equal(existsSync(join(outputDir, 'manifest.json')), false);
});

test('validation failure is an error and leaves no files behind', async () => {
  const outputDir = mkdtempSync(join(tempRoot, 'invalid-'));
  const rows = validRows({ settings: null });

  await assert.rejects(
    syncContent({
      fetcher: {
        async batch<T>(input: Array<{ sql: string }>): Promise<Array<{ results: T[] }>> {
          assert.equal(input.length, 15);
          return rowsToBatchResults(rows) as Array<{ results: T[] }>;
        },
      },
      outputDir,
    }),
    SnapshotValidationError,
  );

  assert.deepEqual(existsSync(join(outputDir, 'public-content.json')), false);
});

test('a successful sync writes both snapshot files atomically', async () => {
  const outputDir = mkdtempSync(join(tempRoot, 'ok-'));
  const rows = validRows();

  const manifest = await syncContent({
    fetcher: {
      async batch<T>(): Promise<Array<{ results: T[] }>> {
        return rowsToBatchResults(rows) as Array<{ results: T[] }>;
      },
    },
    outputDir,
    generatedAt: '2026-06-01T00:00:00.000Z',
  });

  const snapshotFile = JSON.parse(readFileSync(join(outputDir, 'public-content.json'), 'utf8'));
  assert.equal(snapshotFile.mandaps.length, 1);
  assert.equal(manifest.generatedAt, '2026-06-01T00:00:00.000Z');
  assert.equal(existsSync(join(outputDir, 'manifest.json')), true);
  assert.equal(existsSync(join(outputDir, 'public-content.json.tmp')), false);
});

test('report config and delivery are best-effort', async () => {
  assert.deepEqual(resolveReportConfig({}).missing, ['PUBLISH_REPORT_URL', 'PUBLISH_REPORT_SECRET']);

  const { config } = resolveReportConfig({
    PUBLISH_REPORT_URL: 'https://site.test/api/internal/publish-report',
    PUBLISH_REPORT_SECRET: 'shh',
    CONTENT_SNAPSHOT_DIR: tempRoot,
  });
  assert.ok(config);

  const report = buildReport(buildManifest(buildSnapshot(validRows())), { VERCEL_URL: 'event-point-abc.vercel.app' });
  assert.equal(report.deploymentUrl, 'event-point-abc.vercel.app');

  const accepted = await reportPublication(config!, report, async () => new Response('{}', { status: 200 }));
  assert.equal(accepted, true);

  const rejected = await reportPublication(config!, report, async () => new Response('{}', { status: 500 }));
  assert.equal(rejected, false);

  const unreachable = await reportPublication(config!, report, async () => {
    throw new Error('offline');
  });
  assert.equal(unreachable, false);
});

test('static paths come only from snapshot collection slugs', () => {
  const snapshot = buildSnapshot(validRows());
  const paths = snapshotStaticPaths(snapshot);

  assert.deepEqual(paths.mandaps, [{ params: { slug: 'royal-mandap' } }]);
  assert.deepEqual(paths.stages, [{ params: { slug: 'royal-stage' } }]);
  assert.deepEqual(staticPathsForSlugs(['a', 'a', 'b']), [{ params: { slug: 'a' } }, { params: { slug: 'b' } }]);
});

function rowsToBatchResults(rows: PublicContentRows): Array<{ results: Array<Record<string, unknown>> }> {
  return [
    { results: rows.settings ? [rows.settings] : [] },
    { results: rows.pages },
    { results: rows.seo },
    { results: rows.homeSections },
    { results: rows.services },
    { results: rows.mandaps },
    { results: rows.mandapGallery },
    { results: rows.stages },
    { results: rows.stageGallery },
    { results: rows.furnitureCategories },
    { results: rows.furnitureItems },
    { results: rows.cateringPackages },
    { results: rows.galleryCategories },
    { results: rows.galleryItems },
    { results: rows.videos },
  ];
}
