/**
 * Merges the local SQLite catalog (gallery + catering) into Cloudflare D1.
 *
 *   npm run db:migrate:catalog            # apply
 *   npm run db:migrate:catalog -- --dry-run
 *
 * Semantics (agreed with the project owner): upsert by slug / image URL with
 * local values winning, D1-only rows preserved, nothing deleted except the
 * menu structure of packages that are re-synced from local. Idempotent.
 *
 * After this runs, the admin CMS and the published snapshot both read D1.
 */
import { all } from '../src/core/db';
import { D1Client } from '../src/core/content/d1-client';
import { d1SchemaSql } from '../src/core/content/d1-schema';

export interface CatalogMigrationSummary {
  galleryCategories: { inserted: number; updated: number };
  galleryItems: { inserted: number; updated: number; preserved: number };
  packages: { inserted: number; updated: number; preserved: number; children: number };
  dryRun: boolean;
}

interface GalleryCategoryRow {
  id: number;
  name: string;
  slug: string;
  sort: number;
  is_active: number;
}

interface GalleryItemRow {
  id: number;
  category_id: number;
  title: string;
  image: string;
  created_at: string;
  is_active: number;
}

interface PackageRow {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  price_paise: number;
  description: string;
  badge: string;
  show_on_home: number;
  is_active: number;
}

interface NameRow {
  id: number;
  package_id: number;
  name: string;
}

interface GuestPricingRow {
  id: number;
  package_id: number;
  guest_count: number;
  price_per_plate_paise: number;
  sort: number;
}

interface MenuSectionRow {
  id: number;
  package_id: number;
  title: string;
  has_category: number;
  available_items: number;
  max_selection: number;
  sort: number;
}

interface MenuCategoryRow {
  id: number;
  section_id: number;
  title: string;
  sort: number;
}

interface MenuItemRow {
  id: number;
  category_id: number;
  name: string;
  is_available: number;
}

/** The whole schema is idempotent, so running it guarantees the new tables exist. */
export async function ensureD1CatalogSchema(client: D1Client): Promise<number> {
  const statements = d1SchemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(--[^\n]*\n?)+$/.test(statement))
    .map((sql) => ({ sql }));

  await client.batch(statements);
  return statements.length;
}

export async function migrateCatalog(
  client: D1Client,
  options: { dryRun?: boolean; log?: (message: string) => void } = {},
): Promise<CatalogMigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});

  const summary: CatalogMigrationSummary = {
    galleryCategories: { inserted: 0, updated: 0 },
    galleryItems: { inserted: 0, updated: 0, preserved: 0 },
    packages: { inserted: 0, updated: 0, preserved: 0, children: 0 },
    dryRun,
  };

  log(`[migrate:catalog] ensuring D1 schema${dryRun ? ' (dry run)' : ''}…`);
  // DDL is additive and idempotent, so it also runs for a dry run — the read
  // queries below need the new tables to exist.
  const count = await ensureD1CatalogSchema(client);
  log(`[migrate:catalog] schema ready (${count} statements)`);

  /* ----------------------------- Gallery ----------------------------- */

  const localCategories = all<GalleryCategoryRow>(
    'SELECT id, name, slug, sort, is_active FROM gallery_categories ORDER BY sort, id',
  );
  const d1Categories = (
    await client.query<{ id: number; slug: string }>('SELECT id, slug FROM gallery_categories')
  ).results;
  const d1CategoryBySlug = new Map(d1Categories.map((row) => [row.slug, row.id]));
  const categoryIdMap = new Map<number, number>();

  for (const category of localCategories) {
    const existing = d1CategoryBySlug.get(category.slug);
    if (existing) {
      summary.galleryCategories.updated += 1;
      categoryIdMap.set(category.id, existing);
      if (!dryRun) {
        await client.query(
          'UPDATE gallery_categories SET name = ?, sort_order = ?, is_visible = ? WHERE id = ?',
          [category.name, category.sort, category.is_active, existing],
        );
      }
    } else {
      summary.galleryCategories.inserted += 1;
      if (!dryRun) {
        const res = await client.query(
          'INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES (?, ?, ?, ?)',
          [category.name, category.slug, category.sort, category.is_active],
        );
        const newId = Number(res.meta.last_row_id ?? 0);
        categoryIdMap.set(category.id, newId);
      }
    }
  }

  const localItems = all<GalleryItemRow>(
    'SELECT id, category_id, title, image, created_at, is_active FROM gallery_items ORDER BY created_at DESC, id DESC',
  );
  const d1Items = (
    await client.query<{ id: number; image_url: string }>('SELECT id, image_url FROM gallery_items')
  ).results;
  const d1ItemByImage = new Map(d1Items.map((row) => [row.image_url, row.id]));
  const matchedImages = new Set<string>();

  let sortOrder = 1;
  for (const item of localItems) {
    if (!item.image) continue;
    const categoryId = categoryIdMap.get(item.category_id);
    if (!categoryId) continue;

    matchedImages.add(item.image);
    const existing = d1ItemByImage.get(item.image);

    if (existing) {
      summary.galleryItems.updated += 1;
      if (!dryRun) {
        await client.query(
          'UPDATE gallery_items SET category_id = ?, caption = ?, alt_text = ?, sort_order = ?, is_visible = ? WHERE id = ?',
          [categoryId, item.title, item.title, sortOrder, item.is_active, existing],
        );
      }
    } else {
      summary.galleryItems.inserted += 1;
      if (!dryRun) {
        await client.query(
          'INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [categoryId, item.title, item.image, item.title, sortOrder, item.is_active, item.created_at],
        );
      }
    }
    sortOrder += 1;
  }

  summary.galleryItems.preserved = d1Items.filter((row) => !matchedImages.has(row.image_url)).length;

  /* ---------------------------- Catering ----------------------------- */

  const localPackages = all<PackageRow>(
    'SELECT id, name, slug, image, price_paise, description, badge, show_on_home, is_active FROM catering_packages ORDER BY id',
  );
  const features = all<NameRow>('SELECT id, package_id, name FROM catering_features ORDER BY id');
  const bannerFeatures = all<NameRow>('SELECT id, package_id, name FROM banner_features ORDER BY id');
  const pricing = all<GuestPricingRow>(
    'SELECT id, package_id, guest_count, price_per_plate_paise, sort FROM guest_pricing ORDER BY sort, guest_count',
  );
  const sections = all<MenuSectionRow>(
    'SELECT id, package_id, title, has_category, available_items, max_selection, sort FROM menu_sections ORDER BY sort, id',
  );
  const categories = all<MenuCategoryRow>('SELECT id, section_id, title, sort FROM menu_categories ORDER BY sort, id');
  const items = all<MenuItemRow>('SELECT id, category_id, name, is_available FROM menu_items ORDER BY id');

  const d1Packages = (
    await client.query<{ id: number; slug: string }>('SELECT id, slug FROM catering_packages')
  ).results;
  const d1PackageBySlug = new Map(d1Packages.map((row) => [row.slug, row.id]));
  const matchedSlugs = new Set<string>();

  for (const pkg of localPackages) {
    matchedSlugs.add(pkg.slug);
    const existing = d1PackageBySlug.get(pkg.slug);
    let packageId: number;

    if (existing) {
      summary.packages.updated += 1;
      packageId = existing;
      if (!dryRun) {
        await client.query(
          `UPDATE catering_packages SET name = ?, description = ?, badge = ?, image_url = ?,
             price_per_plate_paise = ?, show_on_home = ?, is_visible = ?, updated_at = datetime('now') WHERE id = ?`,
          [
            pkg.name,
            pkg.description,
            pkg.badge,
            pkg.image,
            pkg.price_paise,
            pkg.show_on_home,
            pkg.is_active,
            existing,
          ],
        );
      }
    } else {
      summary.packages.inserted += 1;
      if (dryRun) {
        packageId = 0;
      } else {
        const res = await client.query(
          `INSERT INTO catering_packages
             (name, slug, description, badge, image_url, price_per_plate_paise, show_on_home, is_visible)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [pkg.name, pkg.slug, pkg.description, pkg.badge, pkg.image, pkg.price_paise, pkg.show_on_home, pkg.is_active],
        );
        packageId = Number(res.meta.last_row_id ?? 0);
      }
    }

    if (packageId === 0) continue;

    const packageFeatures = features.filter((row) => row.package_id === pkg.id);
    const packageBanner = bannerFeatures.filter((row) => row.package_id === pkg.id);
    const packagePricing = pricing.filter((row) => row.package_id === pkg.id);
    const packageSections = sections.filter((row) => row.package_id === pkg.id);

    summary.packages.children +=
      packageFeatures.length + packageBanner.length + packagePricing.length + packageSections.length;

    if (dryRun) continue;

    // Rebuild the menu structure for matched packages from the local copy.
    await client.batch([
      { sql: 'DELETE FROM menu_items WHERE category_id IN (SELECT id FROM menu_categories WHERE section_id IN (SELECT id FROM menu_sections WHERE package_id = ?))', params: [packageId] },
      { sql: 'DELETE FROM menu_categories WHERE section_id IN (SELECT id FROM menu_sections WHERE package_id = ?)', params: [packageId] },
      { sql: 'DELETE FROM menu_sections WHERE package_id = ?', params: [packageId] },
      { sql: 'DELETE FROM catering_features WHERE package_id = ?', params: [packageId] },
      { sql: 'DELETE FROM banner_features WHERE package_id = ?', params: [packageId] },
      { sql: 'DELETE FROM guest_pricing WHERE package_id = ?', params: [packageId] },
    ]);

    const sectionIdMap = new Map<number, number>();
    for (const section of packageSections) {
      const res = await client.query(
        'INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort) VALUES (?, ?, ?, ?, ?, ?)',
        [packageId, section.title, section.has_category, section.available_items, section.max_selection, section.sort],
      );
      sectionIdMap.set(section.id, Number(res.meta.last_row_id ?? 0));
    }

    const categoryIdMapLocal = new Map<number, number>();
    for (const category of categories.filter((row) => sectionIdMap.has(row.section_id))) {
      const res = await client.query('INSERT INTO menu_categories (section_id, title, sort) VALUES (?, ?, ?)', [
        sectionIdMap.get(category.section_id),
        category.title,
        category.sort,
      ]);
      categoryIdMapLocal.set(category.id, Number(res.meta.last_row_id ?? 0));
    }

    await client.batch([
      ...items
        .filter((row) => categoryIdMapLocal.has(row.category_id))
        .map((row) => ({
          sql: 'INSERT INTO menu_items (category_id, name, is_available) VALUES (?, ?, ?)',
          params: [categoryIdMapLocal.get(row.category_id), row.name, row.is_available],
        })),
      ...packageFeatures.map((row) => ({
        sql: 'INSERT INTO catering_features (package_id, name) VALUES (?, ?)',
        params: [packageId, row.name],
      })),
      ...packageBanner.map((row) => ({
        sql: 'INSERT INTO banner_features (package_id, name) VALUES (?, ?)',
        params: [packageId, row.name],
      })),
      ...packagePricing.map((row) => ({
        sql: 'INSERT INTO guest_pricing (package_id, guest_count, price_per_plate_paise, sort) VALUES (?, ?, ?, ?)',
        params: [packageId, row.guest_count, row.price_per_plate_paise, row.sort],
      })),
    ]);
  }

  summary.packages.preserved = d1Packages.filter((row) => !matchedSlugs.has(row.slug)).length;

  return summary;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const client = new D1Client({ timeoutMs: 30000 });

  if (!client.isUsingRemote()) {
    console.error(
      '[migrate:catalog] Cloudflare D1 credentials are not configured; refusing to write to the local fallback.',
    );
    process.exitCode = 1;
    return;
  }

  const summary = await migrateCatalog(client, { dryRun, log: console.log });

  console.log('[migrate:catalog] summary:', JSON.stringify(summary, null, 2));
  if (dryRun) console.log('[migrate:catalog] dry run — nothing was written.');
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('migrate-catalog-to-d1.ts')) {
  main().catch((error: unknown) => {
    console.error('[migrate:catalog] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
