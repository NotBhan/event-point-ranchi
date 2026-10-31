import { getD1Client } from './d1-client';

/**
 * D1-backed catalog store for the gallery and catering catalogue.
 *
 * This is the single place that talks to the catalog tables. The admin CMS
 * mutates through it, and the content service falls back to it when no snapshot
 * is bundled (local development, tests). Rows are returned with their D1 column
 * names; callers map them to their view models.
 */

export interface GalleryCategoryRow {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_visible: number;
}

export interface GalleryItemRow {
  id: number;
  category_id: number;
  caption: string;
  image_url: string;
  alt_text: string;
  is_visible: number;
  sort_order: number;
  created_at: string;
}

export interface CateringPackageRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  badge: string;
  image_url: string;
  price_per_plate_paise: number;
  show_on_home: number;
  is_visible: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CateringNameRow {
  id: number;
  package_id: number;
  name: string;
}

export interface GuestPricingRow {
  id: number;
  package_id: number;
  guest_count: number;
  price_per_plate_paise: number;
  sort: number;
}

export interface MenuSectionRow {
  id: number;
  package_id: number;
  title: string;
  has_category: number;
  available_items: number;
  max_selection: number;
  sort: number;
}

export interface MenuCategoryRow {
  id: number;
  section_id: number;
  title: string;
  sort: number;
}

export interface MenuItemRow {
  id: number;
  category_id: number;
  name: string;
  is_available: number;
}

export interface GalleryCatalog {
  categories: GalleryCategoryRow[];
  items: Array<GalleryItemRow & { category_slug: string; category_name: string }>;
}

export interface CateringCatalog {
  packages: CateringPackageRow[];
  features: CateringNameRow[];
  bannerFeatures: CateringNameRow[];
  guestPricing: GuestPricingRow[];
  sections: MenuSectionRow[];
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
}

/* ------------------------------- Public reads ------------------------------ */

export async function fetchGalleryCatalog(): Promise<GalleryCatalog> {
  const d1 = getD1Client();
  const [categories, items] = await d1.batch<any>([
    {
      sql: 'SELECT id, name, slug, sort_order, is_visible FROM gallery_categories WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC',
    },
    {
      sql: `SELECT gi.id, gi.category_id, gi.caption, gi.image_url, gi.alt_text, gi.is_visible, gi.sort_order, gi.created_at,
                   gc.slug AS category_slug, gc.name AS category_name
            FROM gallery_items gi
            JOIN gallery_categories gc ON gc.id = gi.category_id
            WHERE gi.is_visible = 1 AND gc.is_visible = 1
            ORDER BY gi.sort_order ASC, gi.id ASC`,
    },
  ]);

  return {
    categories: (categories.results ?? []) as GalleryCategoryRow[],
    items: (items.results ?? []) as GalleryCatalog['items'],
  };
}

export async function fetchCateringCatalog(): Promise<CateringCatalog> {
  const d1 = getD1Client();
  const [packages, features, bannerFeatures, guestPricing, sections, categories, items] = await d1.batch<any>([
    { sql: 'SELECT * FROM catering_packages WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT id, package_id, name FROM catering_features ORDER BY id ASC' },
    { sql: 'SELECT id, package_id, name FROM banner_features ORDER BY id ASC' },
    { sql: 'SELECT id, package_id, guest_count, price_per_plate_paise, sort FROM guest_pricing ORDER BY sort ASC, guest_count ASC' },
    { sql: 'SELECT id, package_id, title, has_category, available_items, max_selection, sort FROM menu_sections ORDER BY sort ASC, id ASC' },
    { sql: 'SELECT id, section_id, title, sort FROM menu_categories ORDER BY sort ASC, id ASC' },
    { sql: 'SELECT id, category_id, name, is_available FROM menu_items ORDER BY id ASC' },
  ]);

  return {
    packages: (packages.results ?? []) as CateringPackageRow[],
    features: (features.results ?? []) as CateringNameRow[],
    bannerFeatures: (bannerFeatures.results ?? []) as CateringNameRow[],
    guestPricing: (guestPricing.results ?? []) as GuestPricingRow[],
    sections: (sections.results ?? []) as MenuSectionRow[],
    categories: (categories.results ?? []) as MenuCategoryRow[],
    items: (items.results ?? []) as MenuItemRow[],
  };
}

/* --------------------------------- Gallery -------------------------------- */

export interface GalleryAdminPage {
  categories: Array<GalleryCategoryRow & { item_count: number }>;
  items: GalleryItemRow[];
  totalCount: number;
}

export async function listGalleryAdminRows(options: {
  page: number;
  perPage: number;
  categoryId?: number;
}): Promise<GalleryAdminPage> {
  const d1 = getD1Client();
  const categoryId = options.categoryId ?? 0;
  const where = categoryId > 0 ? 'WHERE category_id = ?' : '';
  const params = categoryId > 0 ? [categoryId] : [];
  const offset = (options.page - 1) * options.perPage;

  const [categories, total, items] = await d1.batch<any>([
    {
      sql: `SELECT gc.id, gc.name, gc.slug, gc.sort_order, gc.is_visible,
                   (SELECT COUNT(*) FROM gallery_items gi WHERE gi.category_id = gc.id) AS item_count
            FROM gallery_categories gc ORDER BY gc.sort_order ASC, gc.name ASC`,
    },
    { sql: `SELECT COUNT(*) AS count FROM gallery_items ${where}`, params },
    {
      sql: `SELECT id, category_id, caption, image_url, alt_text, is_visible, sort_order, created_at
            FROM gallery_items ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      params: [...params, options.perPage, offset],
    },
  ]);

  return {
    categories: (categories.results ?? []) as GalleryAdminPage['categories'],
    items: (items.results ?? []) as GalleryItemRow[],
    totalCount: Number((total.results ?? [])[0]?.count ?? 0),
  };
}

export async function findGalleryItem(id: number): Promise<GalleryItemRow | null> {
  const res = await getD1Client().query<GalleryItemRow>(
    'SELECT id, category_id, caption, image_url, alt_text, is_visible, sort_order, created_at FROM gallery_items WHERE id = ? LIMIT 1',
    [id],
  );
  return (res.results ?? [])[0] ?? null;
}

export async function galleryCategorySlugTaken(slug: string, excludeId = 0): Promise<boolean> {
  const res = await getD1Client().query<{ id: number }>(
    'SELECT id FROM gallery_categories WHERE slug = ? AND id != ? LIMIT 1',
    [slug, excludeId],
  );
  return (res.results ?? []).length > 0;
}

export async function findGalleryCategory(id: number): Promise<GalleryCategoryRow | null> {
  const res = await getD1Client().query<GalleryCategoryRow>(
    'SELECT id, name, slug, sort_order, is_visible FROM gallery_categories WHERE id = ? LIMIT 1',
    [id],
  );
  return (res.results ?? [])[0] ?? null;
}

export async function insertGalleryCategory(name: string, slug: string): Promise<number> {
  const res = await getD1Client().query(
    `INSERT INTO gallery_categories (name, slug, sort_order, is_visible)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM gallery_categories), 1)`,
    [name, slug],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function deleteGalleryCategory(id: number): Promise<void> {
  const d1 = getD1Client();
  await d1.batch([
    { sql: 'DELETE FROM gallery_items WHERE category_id = ?', params: [id] },
    { sql: 'DELETE FROM gallery_categories WHERE id = ?', params: [id] },
  ]);
}

export async function toggleGalleryCategoryVisibility(id: number): Promise<boolean> {
  const d1 = getD1Client();
  await d1.query('UPDATE gallery_categories SET is_visible = CASE is_visible WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  const res = await d1.query<{ is_visible: number }>('SELECT is_visible FROM gallery_categories WHERE id = ? LIMIT 1', [id]);
  return Boolean((res.results ?? [])[0]?.is_visible);
}

export async function insertGalleryItem(input: {
  categoryId: number;
  caption: string;
  imageUrl: string;
}): Promise<number> {
  const res = await getD1Client().query(
    `INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM gallery_items), 1)`,
    [input.categoryId, input.caption, input.imageUrl, input.caption],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function updateGalleryItemImage(id: number, imageUrl: string): Promise<void> {
  await getD1Client().query('UPDATE gallery_items SET image_url = ? WHERE id = ?', [imageUrl, id]);
}

export async function updateGalleryItemCaption(id: number, caption: string): Promise<void> {
  await getD1Client().query('UPDATE gallery_items SET caption = ?, alt_text = ? WHERE id = ?', [caption, caption, id]);
}

export async function updateGalleryItemCategory(id: number, categoryId: number): Promise<void> {
  await getD1Client().query('UPDATE gallery_items SET category_id = ? WHERE id = ?', [categoryId, id]);
}

export async function deleteGalleryItem(id: number): Promise<void> {
  await getD1Client().query('DELETE FROM gallery_items WHERE id = ?', [id]);
}

export async function toggleGalleryItemVisibility(id: number): Promise<boolean> {
  const d1 = getD1Client();
  await d1.query('UPDATE gallery_items SET is_visible = CASE is_visible WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  const res = await d1.query<{ is_visible: number }>('SELECT is_visible FROM gallery_items WHERE id = ? LIMIT 1', [id]);
  return Boolean((res.results ?? [])[0]?.is_visible);
}

/* -------------------------------- Catering -------------------------------- */

export interface CateringAdminPage {
  items: Array<
    CateringPackageRow & { section_count: number; item_count: number }
  >;
  totalCount: number;
}

export async function listCateringAdminRows(page: number, perPage: number): Promise<CateringAdminPage> {
  const offset = (page - 1) * perPage;
  const [total, items] = await getD1Client().batch<any>([
    { sql: 'SELECT COUNT(*) AS count FROM catering_packages' },
    {
      sql: `SELECT cp.id, cp.name, cp.slug, cp.description, cp.badge, cp.image_url, cp.price_per_plate_paise,
                   cp.show_on_home, cp.is_visible, cp.sort_order,
                   COALESCE(ms.section_count, 0) AS section_count,
                   COALESCE(mi.item_count, 0) AS item_count
            FROM catering_packages cp
            LEFT JOIN (
              SELECT package_id, COUNT(*) AS section_count FROM menu_sections GROUP BY package_id
            ) ms ON ms.package_id = cp.id
            LEFT JOIN (
              SELECT ms.package_id, COUNT(mi.id) AS item_count
              FROM menu_sections ms
              JOIN menu_categories mc ON mc.section_id = ms.id
              JOIN menu_items mi ON mi.category_id = mc.id
              GROUP BY ms.package_id
            ) mi ON mi.package_id = cp.id
            ORDER BY cp.is_visible DESC, cp.id ASC
            LIMIT ? OFFSET ?`,
      params: [perPage, offset],
    },
  ]);

  return {
    items: (items.results ?? []) as CateringAdminPage['items'],
    totalCount: Number((total.results ?? [])[0]?.count ?? 0),
  };
}

export interface CateringPackageAdminData {
  package: CateringPackageRow;
  features: CateringNameRow[];
  bannerFeatures: CateringNameRow[];
  pricing: GuestPricingRow[];
  sections: Array<MenuSectionRow & { items: MenuItemRow[] }>;
}

export async function loadCateringPackageAdmin(id: number): Promise<CateringPackageAdminData | null> {
  const [pkgRes, features, bannerFeatures, pricing, sections, items] = await getD1Client().batch<any>([
    { sql: 'SELECT * FROM catering_packages WHERE id = ? LIMIT 1', params: [id] },
    { sql: 'SELECT id, package_id, name FROM catering_features WHERE package_id = ? ORDER BY id ASC', params: [id] },
    { sql: 'SELECT id, package_id, name FROM banner_features WHERE package_id = ? ORDER BY id ASC', params: [id] },
    {
      sql: 'SELECT id, package_id, guest_count, price_per_plate_paise, sort FROM guest_pricing WHERE package_id = ? ORDER BY sort ASC, guest_count ASC',
      params: [id],
    },
    {
      sql: 'SELECT id, package_id, title, has_category, available_items, max_selection, sort FROM menu_sections WHERE package_id = ? ORDER BY sort ASC, id ASC',
      params: [id],
    },
    {
      sql: `SELECT mi.id, mi.category_id, mi.name, mi.is_available, mc.section_id
            FROM menu_items mi
            JOIN menu_categories mc ON mc.id = mi.category_id
            JOIN menu_sections ms ON ms.id = mc.section_id
            WHERE ms.package_id = ? ORDER BY mi.id ASC`,
      params: [id],
    },
  ]);

  const packageRow = (pkgRes.results ?? [])[0] as CateringPackageRow | undefined;
  if (!packageRow) return null;

  const sectionRows = (sections.results ?? []) as MenuSectionRow[];
  const itemRows = (items.results ?? []) as Array<MenuItemRow & { section_id: number }>;

  return {
    package: packageRow,
    features: (features.results ?? []) as CateringNameRow[],
    bannerFeatures: (bannerFeatures.results ?? []) as CateringNameRow[],
    pricing: (pricing.results ?? []) as GuestPricingRow[],
    sections: sectionRows.map((section) => ({
      ...section,
      items: itemRows.filter((item) => item.section_id === section.id),
    })),
  };
}

export async function cateringSlugTaken(slug: string, excludeId = 0): Promise<boolean> {
  const res = await getD1Client().query<{ id: number }>(
    'SELECT id FROM catering_packages WHERE slug = ? AND id != ? LIMIT 1',
    [slug, excludeId],
  );
  return (res.results ?? []).length > 0;
}

export async function countVisibleCateringPackages(): Promise<number> {
  const res = await getD1Client().query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM catering_packages WHERE is_visible = 1',
  );
  return Number((res.results ?? [])[0]?.count ?? 0);
}

/**
 * New packages start with one menu section and one selection group, mirroring
 * the previous SQLite behaviour. Both statements go out in a single batch.
 */
export async function seedDefaultMenuSection(packageId: number): Promise<void> {
  await getD1Client().batch([
    {
      sql: `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
            VALUES (?, 'Starters & Appetizers', 1, 0, 3, 1)`,
      params: [packageId],
    },
    {
      sql: `INSERT INTO menu_categories (section_id, title, sort)
            SELECT id, 'Signature Bites', 1 FROM menu_sections WHERE package_id = ? ORDER BY id DESC LIMIT 1`,
      params: [packageId],
    },
  ]);
}

export interface CateringPackageInput {
  name: string;
  slug: string;
  imageUrl: string | null;
  pricePaise: number;
  description: string;
  badge: string;
  showOnHome: number;
  isVisible: number;
}

export async function insertCateringPackage(input: CateringPackageInput): Promise<number> {
  const res = await getD1Client().query(
    `INSERT INTO catering_packages
       (name, slug, description, badge, image_url, price_per_plate_paise, show_on_home, is_visible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.slug,
      input.description,
      input.badge,
      input.imageUrl,
      input.pricePaise,
      input.showOnHome,
      input.isVisible,
    ],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function updateCateringPackage(id: number, input: CateringPackageInput): Promise<void> {
  await getD1Client().query(
    `UPDATE catering_packages SET name = ?, slug = ?, description = ?, badge = ?, image_url = ?,
       price_per_plate_paise = ?, show_on_home = ?, is_visible = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.name,
      input.slug,
      input.description,
      input.badge,
      input.imageUrl,
      input.pricePaise,
      input.showOnHome,
      input.isVisible,
      id,
    ],
  );
}

export async function deleteCateringPackage(id: number): Promise<void> {
  const d1 = getD1Client();
  await d1.batch([
    {
      sql: 'DELETE FROM menu_items WHERE category_id IN (SELECT id FROM menu_categories WHERE section_id IN (SELECT id FROM menu_sections WHERE package_id = ?))',
      params: [id],
    },
    { sql: 'DELETE FROM menu_categories WHERE section_id IN (SELECT id FROM menu_sections WHERE package_id = ?)', params: [id] },
    { sql: 'DELETE FROM menu_sections WHERE package_id = ?', params: [id] },
    { sql: 'DELETE FROM catering_features WHERE package_id = ?', params: [id] },
    { sql: 'DELETE FROM banner_features WHERE package_id = ?', params: [id] },
    { sql: 'DELETE FROM guest_pricing WHERE package_id = ?', params: [id] },
    { sql: 'DELETE FROM catering_packages WHERE id = ?', params: [id] },
  ]);
}

export async function toggleCateringVisibility(id: number): Promise<void> {
  await getD1Client().query(
    'UPDATE catering_packages SET is_visible = CASE is_visible WHEN 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id],
  );
}

export async function toggleCateringHome(id: number): Promise<void> {
  await getD1Client().query(
    'UPDATE catering_packages SET show_on_home = CASE show_on_home WHEN 1 THEN 0 ELSE 1 END WHERE id = ?',
    [id],
  );
}

export async function insertMenuSection(
  packageId: number,
  title: string,
  maxSelection: number,
): Promise<number> {
  const res = await getD1Client().query(
    `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
     VALUES (?, ?, 1, 0, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM menu_sections WHERE package_id = ?))`,
    [packageId, title, maxSelection, packageId],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function updateMenuSection(sectionId: number, title: string, maxSelection: number): Promise<void> {
  await getD1Client().query('UPDATE menu_sections SET title = ?, max_selection = ? WHERE id = ?', [
    title,
    maxSelection,
    sectionId,
  ]);
}

export async function deleteMenuSection(sectionId: number): Promise<void> {
  const d1 = getD1Client();
  await d1.batch([
    {
      sql: 'DELETE FROM menu_items WHERE category_id IN (SELECT id FROM menu_categories WHERE section_id = ?)',
      params: [sectionId],
    },
    { sql: 'DELETE FROM menu_categories WHERE section_id = ?', params: [sectionId] },
    { sql: 'DELETE FROM menu_sections WHERE id = ?', params: [sectionId] },
  ]);
}

export async function insertMenuCategory(sectionId: number, title: string): Promise<number> {
  const res = await getD1Client().query(
    `INSERT INTO menu_categories (section_id, title, sort)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM menu_categories WHERE section_id = ?))`,
    [sectionId, title, sectionId],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function findFirstMenuCategory(sectionId: number): Promise<number | null> {
  const res = await getD1Client().query<{ id: number }>(
    'SELECT id FROM menu_categories WHERE section_id = ? ORDER BY sort ASC, id ASC LIMIT 1',
    [sectionId],
  );
  return (res.results ?? [])[0]?.id ?? null;
}

export async function insertMenuItem(categoryId: number, name: string): Promise<number> {
  const res = await getD1Client().query(
    'INSERT INTO menu_items (category_id, name, is_available) VALUES (?, ?, 1)',
    [categoryId, name],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function findMenuSectionPackageId(sectionId: number): Promise<number | null> {
  const res = await getD1Client().query<{ package_id: number }>(
    'SELECT package_id FROM menu_sections WHERE id = ? LIMIT 1',
    [sectionId],
  );
  return (res.results ?? [])[0]?.package_id ?? null;
}

export async function findMenuSectionOfItem(itemId: number): Promise<number | null> {
  const res = await getD1Client().query<{ section_id: number }>(
    `SELECT mc.section_id AS section_id
     FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE mi.id = ? LIMIT 1`,
    [itemId],
  );
  return (res.results ?? [])[0]?.section_id ?? null;
}

export async function updateMenuItemName(itemId: number, name: string): Promise<void> {
  await getD1Client().query('UPDATE menu_items SET name = ? WHERE id = ?', [name, itemId]);
}

export async function deleteMenuItem(itemId: number): Promise<void> {
  await getD1Client().query('DELETE FROM menu_items WHERE id = ?', [itemId]);
}

export async function toggleMenuItemAvailability(itemId: number): Promise<void> {
  await getD1Client().query(
    'UPDATE menu_items SET is_available = CASE is_available WHEN 1 THEN 0 ELSE 1 END WHERE id = ?',
    [itemId],
  );
}

export async function insertGuestPricing(
  packageId: number,
  guestCount: number,
  pricePaise: number,
): Promise<number> {
  const res = await getD1Client().query(
    `INSERT INTO guest_pricing (package_id, guest_count, price_per_plate_paise, sort)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM guest_pricing WHERE package_id = ?))`,
    [packageId, guestCount, pricePaise, packageId],
  );
  return Number(res.meta.last_row_id ?? 0);
}

export async function deleteGuestPricing(id: number): Promise<void> {
  await getD1Client().query('DELETE FROM guest_pricing WHERE id = ?', [id]);
}

export async function insertPackageOption(
  table: 'catering_features' | 'banner_features',
  packageId: number,
  name: string,
): Promise<number> {
  const res = await getD1Client().query(`INSERT INTO ${table} (package_id, name) VALUES (?, ?)`, [packageId, name]);
  return Number(res.meta.last_row_id ?? 0);
}

export async function deletePackageOption(
  table: 'catering_features' | 'banner_features',
  id: number,
): Promise<void> {
  await getD1Client().query(`DELETE FROM ${table} WHERE id = ?`, [id]);
}
