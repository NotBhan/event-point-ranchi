import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-catalog-test-'));

// Public reads fall back to D1 when no snapshot is bundled; force its SQLite
// fallback with an isolated data dir so tests never touch production D1.
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.D1_LOCAL = '1';
process.env.APP_SECRET = 'catalog-test-secret';

const { getD1Client } = await import('../src/core/content/d1-client');
const catalog = await import('../src/core/content/catalog-store');
const { loadGalleryPage } = await import('../src/modules/gallery/service');
const { loadCateringPage, loadPackageDetail } = await import('../src/modules/catering/service');
const { loadHomePage } = await import('../src/modules/home/service');
const { loadContactInfo } = await import('../src/modules/contact/service');
const { addGalleryCategory, listCateringAdmin, loadCateringAdmin } = await import('../src/modules/admin/service');
const adminCatalog = await import('../src/modules/admin/service');

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let seeded = false;

async function seedCatalog(): Promise<void> {
  if (seeded) return;

  const d1 = getD1Client();

  await d1.query(
    `INSERT INTO site_settings
       (id, name, legal_name, tagline, short_description, logo_url, favicon_url, phone, whatsapp, email,
        address, venue_address, business_hours, default_title, default_description, og_image_url)
     VALUES ('global', 'Event Point Ranchi', 'Event Point', 'Weddings in Ranchi', 'Event decorators',
             '', '', '+91 90000 00001', '919000000001', 'hello@eventpoint.test',
             'Main Road, Ranchi', 'Venue Road, Ranchi', 'Daily, 10:00 - 19:00',
             'Event Point Ranchi', 'Wedding mandaps and stages', '')`,
  );

  // Mandaps, stages, furniture
  await d1.query(
    "INSERT INTO mandaps (name, slug, description, image_url, category, is_visible, sort_order) VALUES ('Royal Mandap', 'royal-mandap', 'Carved pillars', '/storage/m1.webp', 'Traditional Royal', 1, 1)",
  );
  await d1.query(
    "INSERT INTO mandaps (name, slug, description, image_url, category, is_visible, sort_order) VALUES ('Lotus Mandap', 'lotus-mandap', 'Floral dome', '/storage/m2.webp', 'Floral', 1, 2)",
  );
  await d1.query(
    "INSERT INTO stages (name, slug, description, image_url, style_category, is_visible, sort_order) VALUES ('Royal Stage', 'royal-stage', 'Gold backdrop', '/storage/s1.webp', 'Royal Reception', 1, 1)",
  );
  const furnitureCategory = await d1.query(
    "INSERT INTO furniture_categories (name, slug, icon, sort_order, is_visible) VALUES ('Chairs', 'chairs', 'chair', 1, 1)",
  );
  const furnitureCategoryId = Number(furnitureCategory.meta.last_row_id ?? 0);
  await d1.query(
    `INSERT INTO furniture_items (category_id, name, slug, description, image_url, price_paise, pricing_unit, min_quantity, default_quantity, is_visible, sort_order)
     VALUES (?, 'Golden Chiavari Chair', 'golden-chiavari-chair', 'Gold finish', '', 25000, 'per chair', 1, 10, 1, 1)`,
    [furnitureCategoryId],
  );
  await d1.query(
    `INSERT INTO furniture_items (category_id, name, slug, description, image_url, price_paise, pricing_unit, min_quantity, default_quantity, is_visible, sort_order)
     VALUES (?, 'Ivory Chair', 'ivory-chair', 'Ivory finish', '', 20000, 'per chair', 1, 10, 1, 2)`,
    [furnitureCategoryId],
  );

  // Gallery (one hidden item must never render)
  const galleryCategory = await d1.query(
    "INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES ('Mandap Designs', 'mandap-designs', 1, 1)",
  );
  const galleryCategoryId = Number(galleryCategory.meta.last_row_id ?? 0);
  await d1.query(
    'INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible) VALUES (?, ?, ?, ?, 1, 1)',
    [galleryCategoryId, 'Royal mandap', '/storage/g1.webp', 'Royal mandap'],
  );
  await d1.query(
    'INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible) VALUES (?, ?, ?, ?, 2, 0)',
    [galleryCategoryId, 'Hidden draft', '/storage/g2.webp', 'Hidden'],
  );

  // Catering with a full menu
  const silver = await catalog.insertCateringPackage({
    name: 'Silver',
    slug: 'silver',
    imageUrl: '/storage/silver.webp',
    pricePaise: 50000,
    description: 'Essential menu',
    badge: 'Popular',
    showOnHome: 1,
    isVisible: 1,
  });
  await catalog.seedDefaultMenuSection(silver);
  const sectionRes = await d1.query<{ id: number }>(
    'SELECT id FROM menu_sections WHERE package_id = ? LIMIT 1',
    [silver],
  );
  const sectionId = Number(sectionRes.results[0].id);
  const categoryRes = await d1.query<{ id: number }>(
    'SELECT id FROM menu_categories WHERE section_id = ? LIMIT 1',
    [sectionId],
  );
  const categoryId = Number(categoryRes.results[0].id);
  await catalog.insertMenuItem(categoryId, 'Paneer Tikka');
  await catalog.insertMenuItem(categoryId, 'Hara Bhara Kebab');
  const hiddenItem = await catalog.insertMenuItem(categoryId, 'Sold Out Dish');
  await d1.query('UPDATE menu_items SET is_available = 0 WHERE id = ?', [hiddenItem]);
  await catalog.insertPackageOption('catering_features', silver, 'Traditional Sweets');
  await catalog.insertPackageOption('banner_features', silver, 'Live counters');
  await catalog.insertGuestPricing(silver, 100, 50000);

  await catalog.insertCateringPackage({
    name: 'Platinum',
    slug: 'platinum',
    imageUrl: '/storage/platinum.webp',
    pricePaise: 90000,
    description: 'Grand menu',
    badge: '',
    showOnHome: 1,
    isVisible: 1,
  });

  seeded = true;
}

test('gallery reads from D1, hides drafts, and paginates server-side', async () => {
  await seedCatalog();

  const page = await loadGalleryPage();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].title, 'Royal mandap');
  assert.equal(page.items[0].category_slug, 'mandap-designs');
  assert.equal(page.categories.length, 1);
  assert.equal(page.categories[0].count, 1);

  const hidden = await loadGalleryPage({ category: 'does-not-exist' });
  assert.equal(hidden.category, '');
  assert.equal(hidden.items.length, 1);
});

test('catering pages render packages and menus without SQLite', async () => {
  await seedCatalog();

  const page = await loadCateringPage();
  assert.equal(page.packages.length, 2);
  // Ordered by price descending, like the previous SQLite query.
  assert.deepEqual(page.packages.map((pkg) => pkg.slug), ['platinum', 'silver']);
  const silver = page.packages.find((pkg) => pkg.slug === 'silver')!;
  assert.deepEqual(silver.features, ['Traditional Sweets']);
  assert.deepEqual(silver.bannerFeatures, ['Live counters']);
  assert.equal(silver.image, '/storage/silver.webp');

  const detail = await loadPackageDetail('silver');
  assert.ok(detail);
  assert.equal(detail!.guestPricing.length, 1);
  assert.equal(detail!.guestPricing[0].price_per_plate_paise, 50000);
  assert.equal(detail!.sections.length, 1);
  assert.equal(detail!.sections[0].categories.length, 1);
  // Unavailable dishes are filtered out of the public menu.
  assert.deepEqual(
    detail!.sections[0].categories[0].items.map((item) => item.name),
    ['Paneer Tikka', 'Hara Bhara Kebab'],
  );

  assert.equal(await loadPackageDetail('missing'), null);
});

test('homepage is assembled from the catalog store with no SQLite reads', async () => {
  await seedCatalog();

  const home = await loadHomePage();
  assert.equal(home.mandaps.length, 2);
  assert.equal(home.mandaps[0].image, '/storage/m1.webp');
  assert.equal(home.stages.length, 1);
  assert.equal(home.equipment.length, 1);
  assert.equal(home.equipment[0].itemCount, 2);
  assert.equal(home.equipment[0].items[0].unit, 'per chair');
  assert.equal(home.galleryItems.length, 1);
  assert.equal(home.galleryItems[0].title, 'Royal mandap');
  assert.deepEqual(home.stats, { mandaps: 2, stages: 1, equipment: 2, gallery: 1 });
  assert.equal(home.contact.email, 'hello@eventpoint.test');
  assert.equal(home.heroImage, '/storage/m1.webp');
});

test('contact details come from site settings, not the legacy contact table', async () => {
  await seedCatalog();

  const info = await loadContactInfo();
  assert.deepEqual(info, {
    address: 'Main Road, Ranchi',
    phone: '+91 90000 00001',
    email: 'hello@eventpoint.test',
  });
});

test('admin catalog edits land in D1 and show up in the admin listings', async () => {
  await seedCatalog();

  await addGalleryCategory(formWith({ name: 'Reception Ideas' }));
  const gallery = await catalog.listGalleryAdminRows({ page: 1, perPage: 10 });
  assert.ok(gallery.categories.some((category) => category.slug === 'reception-ideas'));

  const cateringList = await listCateringAdmin();
  assert.equal(cateringList.items.length, 2);
  const silver = cateringList.items.find((item) => item.slug === 'silver')!;
  // Admin view-model names are preserved even though D1 uses its own columns.
  assert.equal(silver.price_paise, 50000);
  assert.equal(silver.image, '/storage/silver.webp');
  assert.equal(silver.is_active, 1);
  assert.equal(silver.section_count, 1);
  assert.equal(silver.item_count, 3);
});

test('catering menu, features and pricing can be edited from the admin CMS', async () => {
  await seedCatalog();

  const list = await listCateringAdmin();
  const packageId = list.items.find((item) => item.slug === 'silver')!.id;

  const before = await loadCateringAdmin(packageId);
  assert.ok(before);

  await adminCatalog.addMenuSection(packageId, formWith({ title: 'Desserts', max_selection: '2' }));
  const afterSection = await loadCateringAdmin(packageId);
  const desserts = afterSection!.sections.find((section) => section.title === 'Desserts');
  assert.ok(desserts);
  assert.equal(desserts!.max_selection, 2);

  await adminCatalog.addMenuItem(desserts!.id, formWith({ name: 'Gulab Jamun' }));
  await adminCatalog.addPackageOption('catering_features', packageId, formWith({ name: 'Late-night snacks' }));
  await adminCatalog.addGuestPricing(packageId, formWith({ guest_count: '250', price_per_plate: '550' }));

  const after = await loadCateringAdmin(packageId);
  const dessertsAfter = after!.sections.find((section) => section.title === 'Desserts')!;
  assert.ok(dessertsAfter.items.some((item) => item.name === 'Gulab Jamun'));
  assert.ok(after!.features.some((feature) => feature.name === 'Late-night snacks'));
  assert.ok(after!.pricing.some((tier) => tier.guest_count === 250 && tier.price_per_plate_paise === 55000));

  // Cleanup so later assertions are unaffected.
  await adminCatalog.deleteGuestPricing(
    after!.pricing.find((tier) => tier.guest_count === 250)!.id,
  );
  const snack = after!.features.find((feature) => feature.name === 'Late-night snacks')!;
  await adminCatalog.deletePackageOption('catering_features', snack.id);
  await adminCatalog.deleteMenuSection(dessertsAfter.id);
});

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.append(key, value);
  return form;
}
