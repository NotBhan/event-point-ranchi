import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { PublicContentRows } from '../src/core/content/snapshot-types';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-catering-publish-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.D1_LOCAL = '1';
process.env.TEST_MODE = '1';
process.env.APP_SECRET = 'catering-publish-test-secret';

const { getD1Client } = await import('../src/core/content/d1-client');
const catalog = await import('../src/core/content/catalog-store');
const admin = await import('../src/modules/admin/service');
const content = await import('../src/core/content/service');
const { fetchPublicContentRows, buildSnapshot, buildManifest } = await import('../src/core/content/snapshot-builder');
const { syncContent } = await import('../scripts/sync-content');
const { loadCateringPage, loadPackageDetail } = await import('../src/modules/catering/service');
const { loadPlanCatalogue } = await import('../src/modules/plan/service');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function page(pageKey: string) {
  return {
    id: 1,
    page_key: pageKey,
    title: pageKey,
    subtitle: '',
    description: '',
    banner_image_url: '',
    banner_enabled: 1,
    content_json: '{}',
    seo_title: '',
    seo_description: '',
    og_image_url: '',
    published: 1,
    created_at: '',
    updated_at: '',
  };
}

function publicRows(cateringRows: Awaited<ReturnType<typeof fetchPublicContentRows>>): PublicContentRows {
  return {
    settings: { id: 'global', name: 'Event Point', phone: '+91 90000 00000', email: 'a@b.test', address: 'Ranchi' },
    pages: ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'].map(page),
    seo: [],
    homeSections: [],
    services: [],
    mandaps: [{ id: 1, name: 'Mandap', slug: 'mandap', category: 'Royal', length_ft: 16, width_ft: 16, height_ft: 12, dimension_unit: 'ft', price_starting_paise: 100000, is_visible: 1, is_archived: 0, sort_order: 0, image_url: '', image_alt: '', full_description: '', material_specs: '' }],
    mandapGallery: [],
    stages: [{ id: 1, name: 'Stage', slug: 'stage', style_category: 'Royal', length_ft: 24, width_ft: 16, height_ft: 14, dimension_unit: 'ft', price_starting_paise: 100000, is_visible: 1, is_archived: 0, sort_order: 0, image_url: '', image_alt: '', full_description: '', decoration_notes: '' }],
    stageGallery: [],
    furnitureCategories: [{ id: 1, name: 'Seating', slug: 'seating', icon: 'chair', sort_order: 0, is_visible: 1 }],
    furnitureItems: [{ id: 1, category_id: 1, name: 'Chair', slug: 'chair', description: '', image_url: '', image_alt: '', price_paise: 10000, pricing_unit: 'piece', dimensions: '', specifications: '', min_quantity: 1, default_quantity: 1, is_visible: 1, is_archived: 0, sort_order: 0 }],
    cateringPackages: cateringRows.cateringPackages,
    cateringFeatures: cateringRows.cateringFeatures,
    bannerFeatures: cateringRows.bannerFeatures,
    guestPricing: cateringRows.guestPricing,
    menuSections: cateringRows.menuSections,
    menuCategories: cateringRows.menuCategories,
    menuItems: cateringRows.menuItems,
    galleryCategories: [{ id: 1, name: 'Gallery', slug: 'gallery', sort_order: 0, is_visible: 1 }],
    galleryItems: [{ id: 1, category_id: 1, caption: 'One', image_url: '/storage/gallery/one.webp', alt_text: '', is_visible: 1, sort_order: 0, created_at: '' }],
    videos: [],
    cateringImages: cateringRows.cateringImages,
  } as unknown as PublicContentRows;
}

function batchResults(rows: PublicContentRows) {
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
    { results: rows.cateringFeatures },
    { results: rows.bannerFeatures },
    { results: rows.guestPricing },
    { results: rows.menuSections },
    { results: rows.menuCategories },
    { results: rows.menuItems },
    { results: rows.galleryCategories },
    { results: rows.galleryItems },
    { results: rows.videos },
    { results: rows.cateringImages },
  ];
}

test('catering CRUD, normalized menu/pricing and additional images reach the snapshot and public readers', async () => {
  const d1 = getD1Client();
  const packageId = await catalog.insertCateringPackage({
    name: 'Original Feast',
    slug: 'original-feast',
    description: 'Original description',
    fullDescription: 'Original full description',
    category: 'Signature',
    imageUrl: '/storage/assets/catering/original.webp',
    imageAlt: 'Original image',
    pricePaise: 100000,
    badge: 'Classic',
    showOnHome: 1,
    isVisible: 1,
    sortOrder: 1,
  });

  const sectionId = await catalog.insertMenuSection(packageId, 'Welcome', 2);
  const categoryId = await catalog.insertMenuCategory(sectionId, 'Signature Bites');
  const firstItem = await catalog.insertMenuItem(categoryId, 'Paneer Tikka');
  const secondItem = await catalog.insertMenuItem(categoryId, 'Dahi Ke Kebab');
  await catalog.insertGuestPricing(packageId, 100, 100000);
  const tierId = await catalog.insertGuestPricing(packageId, 250, 120000);
  const imageId = await catalog.insertCateringPackageImage(packageId, '/storage/assets/catering/gallery-one.webp', 'Gallery one');

  await admin.saveCatering(form({
    name: 'Updated Feast',
    price: '1500',
    description: 'Updated description',
    full_description: 'Updated full description',
    category: 'Premium',
    image_alt: 'Updated image',
    image_path: '/storage/assets/catering/original.webp',
    badge: 'Updated',
    sort_order: '2',
    is_active: 'on',
    show_on_home: 'on',
  }), packageId);
  await admin.updateGuestPricing(tierId, form({ guest_count: '300', price_per_plate: '1800' }));
  await admin.updateCateringImageAlt(imageId, form({ alt_text: 'Updated gallery alt' }));
  await admin.moveCateringImage(imageId, -1);
  await admin.moveMenuItem(secondItem, -1);
  await admin.deleteMenuItem(firstItem);

  const saved = await admin.loadCateringAdmin(packageId);
  assert.equal(saved?.package.name, 'Updated Feast');
  assert.equal(saved?.package.slug, 'original-feast', 'editing without a new slug must preserve the public URL');
  assert.equal(saved?.package.category, 'Premium');
  assert.equal(saved?.pricing.find((tier) => tier.id === tierId)?.guest_count, 300);
  assert.equal(saved?.images[0]?.alt_text, 'Updated gallery alt');
  assert.deepEqual(saved?.sections[0]?.items.map((item) => item.name), ['Dahi Ke Kebab']);

  // Prime the public catalogue cache, then prove a later admin edit invalidates it.
  const beforeEdit = await content.getCateringPackages();
  assert.equal(beforeEdit[0]?.name, 'Updated Feast');
  await admin.saveCatering(form({
    name: 'Cache Bust Feast',
    slug: 'cache-bust-feast',
    price: '1600',
    description: 'Updated description',
    full_description: 'Updated full description',
    category: 'Premium',
    is_active: 'on',
  }), packageId);
  const afterEdit = await content.getCateringPackages();
  assert.equal(afterEdit[0]?.name, 'Cache Bust Feast');

  const rows = await fetchPublicContentRows(d1);
  const snapshot = buildSnapshot(publicRows(rows));
  const publishedPackage = snapshot.cateringPackages.find((pkg) => pkg.id === packageId);
  assert.ok(publishedPackage);
  assert.equal(publishedPackage.name, 'Cache Bust Feast');
  assert.equal(publishedPackage.full_description, 'Updated full description');
  assert.equal(publishedPackage.category, 'Premium');
  assert.equal(publishedPackage.images?.[0]?.alt_text, 'Updated gallery alt');
  assert.deepEqual(publishedPackage.menu_sections[0].items.map((item: any) => item.name), ['Dahi Ke Kebab']);
  assert.deepEqual(publishedPackage.guest_pricing.find((tier: any) => tier.guest_count === 300), { guest_count: 300, price_per_plate_paise: 180000, sort: 2 });

  const outputDir = mkdtempSync(join(tempRoot, 'snapshot-'));
  await syncContent({
    fetcher: { async batch<T>() { return batchResults(publicRows(rows)) as Array<{ results: T[] }>; } },
    outputDir,
  });
  const written = JSON.parse(readFileSync(join(outputDir, 'public-content.json'), 'utf8'));
  assert.equal(written.cateringPackages[0].name, 'Cache Bust Feast');
  assert.equal(written.cateringPackages[0].guest_pricing.find((tier: any) => tier.guest_count === 300)?.price_per_plate_paise, 180000);

  const manifest = buildManifest(snapshot, '2026-11-05T00:00:00.000Z');
  (globalThis as any).__eventPointSnapshot = { snapshot, manifest };
  try {
    const page = await loadCateringPage();
    assert.equal(page.packages[0]?.name, 'Cache Bust Feast');
    assert.equal(page.packages[0]?.full_description, 'Updated full description');
    const detail = await loadPackageDetail('cache-bust-feast');
    assert.equal(detail?.package.name, 'Cache Bust Feast');
    assert.deepEqual(detail?.guestPricing.find((tier) => tier.guest_count === 300), { guest_count: 300, price_per_plate_paise: 180000 });
    assert.deepEqual(detail?.sections[0]?.categories[0]?.items.map((item) => item.name), ['Dahi Ke Kebab']);
    const plan = await loadPlanCatalogue();
    const planPackage = plan.catering.find((pkg) => pkg.id === packageId);
    assert.equal(planPackage?.name, 'Cache Bust Feast');
    assert.deepEqual(planPackage?.guest_pricing.find((tier: any) => tier.guest_count === 300), { guest_count: 300, price_per_plate_paise: 180000, sort: 2 });
    const cateringPricing = plan.pricing.catering.find((pkg) => pkg.id === packageId);
    assert.deepEqual(cateringPricing?.guest_pricing.find((tier: any) => tier.guest_count === 300), { guest_count: 300, price_per_plate_paise: 180000, sort: 2 });
  } finally {
    delete (globalThis as any).__eventPointSnapshot;
  }

  await admin.toggleCatering(packageId);
  const hiddenRows = await fetchPublicContentRows(d1);
  const hiddenSnapshot = buildSnapshot(publicRows(hiddenRows));
  assert.equal(hiddenSnapshot.cateringPackages.some((pkg) => pkg.id === packageId), false);
});
