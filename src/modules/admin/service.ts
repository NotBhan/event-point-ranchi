import { all, one, run } from '../../core/db';
import { getBoolean, getInt, getString, parseMoneyToPaise, uniqueSlug } from '../../core/http';
import { formatBytes } from '../../core/storage/config';
import type { StorageDriver } from '../../core/storage/filebase';
import type { QuotaUsage, QuotaWarningLevel, StorageCategory } from '../../core/storage/quota';
import {
  imageStorage,
  type ImageEntityType,
  type ReconcileStorageReport,
  type RetryPendingDeletionsReport,
  type StorageUsageSummary,
} from '../../core/storage/service';
import { getStorageUsage, saveUploadedImage, UploadError } from '../../core/uploads';
import { getD1Client } from '../../core/content/d1-client';
import {
  invalidateContentCache,
  listAllPageContent,
  getMandaps,
  savePageContent,
  saveMandapLocation,
  validateCoordinates,
  validateExternalUrl,
  getVideoPreviews,
  saveVideoPreview,
  deleteVideoPreview,
  toggleVideoPreview,
} from '../../core/content/service';
import {
  getPaymentMetrics,
  listPayments,
  getPaymentById,
  getBookingById,
  getRefundsByPaymentId,
  getInvoiceByPaymentId,
  type CustomerRow,
  type PaymentWebhookEventRow,
} from '../../core/operational/service';
import { getNeonClient } from '../../core/operational/neon-client';
import { getPaymentService } from '../../core/payment/payment-service';

export { UploadError };

/* ============================ Dashboard ============================ */

export function loadDashboard() {
  const counts =
    one<{
      bookings: number;
      pending: number;
      confirmed: number;
      revenue: number;
      halls: number;
      packages: number;
      customers: number;
      inquiries: number;
    }>(
      `SELECT
      (SELECT COUNT(*) FROM bookings) AS bookings,
      (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') AS confirmed,
      (SELECT COALESCE(SUM(total_amount), 0) FROM bookings WHERE status IN ('pending','confirmed')) AS revenue,
      (SELECT COUNT(*) FROM halls WHERE is_active = 1) AS halls,
      (SELECT COUNT(*) FROM catering_packages WHERE is_active = 1) AS packages,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM contact_inquiries WHERE status = 'new') AS inquiries`,
    ) ?? {
      bookings: 0,
      pending: 0,
      confirmed: 0,
      revenue: 0,
      halls: 0,
      packages: 0,
      customers: 0,
      inquiries: 0,
    };

  const recentBookings = all<{
    id: number;
    customer: string;
    event_date: string | null;
    event_type: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    `SELECT b.id, c.name AS customer, b.event_date, b.event_type, b.total_amount, b.status, b.created_at
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     ORDER BY b.id DESC LIMIT 8`,
  );

  const upcoming = all<{
    id: number;
    customer: string;
    event_date: string;
    event_type: string;
    total_guest: number;
    status: string;
  }>(
    `SELECT b.id, c.name AS customer, b.event_date, b.event_type, b.total_guest, b.status
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     WHERE b.event_date >= date('now') AND b.status IN ('pending','confirmed')
     ORDER BY b.event_date ASC LIMIT 6`,
  );

  const topHalls = all<{ name: string; bookings: number; revenue: number }>(
    `SELECT h.name,
            COUNT(b.id) AS bookings,
            COALESCE(SUM(b.total_amount), 0) AS revenue
     FROM halls h
     LEFT JOIN booking_halls bh ON bh.hall_id = h.id
     LEFT JOIN bookings b ON b.id = bh.booking_id AND b.status IN ('pending','confirmed')
     GROUP BY h.id ORDER BY revenue DESC LIMIT 5`,
  );

  return { counts, recentBookings, upcoming, topHalls };
}

/* ============================ Bookings ============================ */

export function listBookings(filters: { status?: string; query?: string } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    clauses.push('b.status = ?');
    params.push(filters.status);
  }
  if (filters.query) {
    clauses.push('(c.name LIKE ? OR c.phone LIKE ? OR CAST(b.id AS TEXT) LIKE ? OR b.event_type LIKE ?)');
    const like = `%${filters.query}%`;
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<{
    id: number;
    customer: string;
    phone: string;
    event_date: string | null;
    event_type: string;
    total_guest: number;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    `SELECT b.id, c.name AS customer, c.phone AS phone, b.event_date, b.event_type,
            b.total_guest, b.total_amount, b.status, b.created_at
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     ${where}
     ORDER BY b.id DESC LIMIT 200`,
    params,
  );
}

export function updateBookingStatus(id: number, status: string): void {
  if (!['draft', 'pending', 'confirmed', 'cancelled'].includes(status)) return;
  run('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);
}

export function deleteBooking(id: number): void {
  run('DELETE FROM bookings WHERE id = ?', [id]);
}

/* ============================ Halls ============================ */

export function listHallsAdmin() {
  return all<{
    id: number;
    name: string;
    slug: string;
    image: string | null;
    price_paise: number;
    capacity: number;
    location: string;
    is_active: number;
    is_featured: number;
    booking_count: number;
  }>(
    `SELECT h.id, h.name, h.slug, h.image, h.price_paise, h.capacity, h.location, h.is_active, h.is_featured,
            (SELECT COUNT(*) FROM booking_halls bh WHERE bh.hall_id = h.id) AS booking_count
     FROM halls h ORDER BY h.is_active DESC, h.id`,
  );
}

export function loadHallAdmin(id: number) {
  return one<Record<string, unknown>>('SELECT * FROM halls WHERE id = ?', [id]);
}

export async function saveHall(form: FormData | null, id?: number): Promise<number> {
  const name = getString(form, 'name');
  if (!name) throw new Error('Hall name is required.');

  const slugInput = getString(form, 'slug') || name;
  const existingId = id ?? 0;
  const slug = uniqueSlug(slugInput, (candidate) => {
    const clash = one<{ id: number }>('SELECT id FROM halls WHERE slug = ? AND id != ?', [candidate, existingId]);
    return Boolean(clash);
  });

  const uploadedImage = await saveUploadedImage(form, 'image', 'halls');
  const uploadedBanner = await saveUploadedImage(form, 'banner_image', 'halls');

  const values = {
    name,
    slug,
    description: getString(form, 'description'),
    image: (uploadedImage ?? getString(form, 'image_path')) || null,
    banner_image: (uploadedBanner ?? getString(form, 'banner_path')) || null,
    price_paise: parseMoneyToPaise(getString(form, 'price')),
    capacity: getInt(form, 'capacity', 0),
    location: getString(form, 'location'),
    parking_capacity: getInt(form, 'parking_capacity', 0),
    is_ac: getBoolean(form, 'is_ac') ? 1 : 0,
    is_wifi: getBoolean(form, 'is_wifi') ? 1 : 0,
    is_featured: getBoolean(form, 'is_featured') ? 1 : 0,
    show_badge: getBoolean(form, 'show_badge') ? 1 : 0,
    is_active: getBoolean(form, 'is_active') ? 1 : 0,
  };

  const params = [
    values.name,
    values.slug,
    values.description,
    values.image,
    values.banner_image,
    values.price_paise,
    values.capacity,
    values.location,
    values.parking_capacity,
    values.is_ac,
    values.is_wifi,
    values.is_featured,
    values.show_badge,
    values.is_active,
  ];

  if (id) {
    run(
      `UPDATE halls SET name = ?, slug = ?, description = ?, image = ?, banner_image = ?, price_paise = ?,
       capacity = ?, location = ?, parking_capacity = ?, is_ac = ?, is_wifi = ?, is_featured = ?, show_badge = ?,
       is_active = ?, updated_at = datetime('now') WHERE id = ?`,
      [...params, id],
    );
    return id;
  }

  return run(
    `INSERT INTO halls (name, slug, description, image, banner_image, price_paise, capacity, location,
       parking_capacity, is_ac, is_wifi, is_featured, show_badge, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params,
  ).lastId;
}

export function deleteHall(id: number): void {
  run('DELETE FROM halls WHERE id = ?', [id]);
}

export function toggleHall(id: number): void {
  run('UPDATE halls SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

/* ============================ Catering ============================ */

export function listCateringAdmin() {
  return all<{
    id: number;
    name: string;
    slug: string;
    image: string | null;
    price_paise: number;
    badge: string;
    is_active: number;
    show_on_home: number;
    section_count: number;
    item_count: number;
  }>(
    `SELECT cp.id, cp.name, cp.slug, cp.image, cp.price_paise, cp.badge, cp.is_active, cp.show_on_home,
            (SELECT COUNT(*) FROM menu_sections ms WHERE ms.package_id = cp.id) AS section_count,
            (SELECT COUNT(*) FROM menu_items mi
              JOIN menu_categories mc ON mc.id = mi.category_id
              JOIN menu_sections ms ON ms.id = mc.section_id
              WHERE ms.package_id = cp.id) AS item_count
     FROM catering_packages cp ORDER BY cp.is_active DESC, cp.id`,
  );
}

export function loadCateringAdmin(id: number) {
  const pkg = one<Record<string, unknown>>('SELECT * FROM catering_packages WHERE id = ?', [id]);
  if (!pkg) return null;

  const features = all<{ id: number; name: string }>(
    'SELECT id, name FROM catering_features WHERE package_id = ? ORDER BY id',
    [id],
  );
  const bannerFeatures = all<{ id: number; name: string }>(
    'SELECT id, name FROM banner_features WHERE package_id = ? ORDER BY id',
    [id],
  );
  const pricing = all<{ id: number; guest_count: number; price_per_plate_paise: number }>(
    'SELECT id, guest_count, price_per_plate_paise FROM guest_pricing WHERE package_id = ? ORDER BY sort, guest_count',
    [id],
  );
  const sections = all<{ id: number; title: string; max_selection: number }>(
    'SELECT id, title, max_selection FROM menu_sections WHERE package_id = ? ORDER BY sort, id',
    [id],
  );
  const items = all<{ id: number; section_id: number; name: string; is_available: number }>(
    `SELECT mi.id, mc.section_id AS section_id, mi.name, mi.is_available
     FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
     JOIN menu_sections ms ON ms.id = mc.section_id
     WHERE ms.package_id = ? ORDER BY mi.id`,
    [id],
  );

  return {
    package: pkg,
    features,
    bannerFeatures,
    pricing,
    sections: sections.map((section) => ({
      ...section,
      items: items.filter((item) => item.section_id === section.id),
    })),
  };
}

export async function saveCatering(form: FormData | null, id?: number): Promise<number> {
  const name = getString(form, 'name');
  if (!name) throw new Error('Package name is required.');

  const existingId = id ?? 0;
  const slug = uniqueSlug(getString(form, 'slug') || name, (candidate) => {
    const clash = one<{ id: number }>(
      'SELECT id FROM catering_packages WHERE slug = ? AND id != ?',
      [candidate, existingId],
    );
    return Boolean(clash);
  });

  const uploaded = await saveUploadedImage(form, 'image', 'catering');
  const values = [
    name,
    slug,
    (uploaded ?? getString(form, 'image_path')) || null,
    parseMoneyToPaise(getString(form, 'price')),
    getString(form, 'description'),
    getString(form, 'badge'),
    getBoolean(form, 'show_on_home') ? 1 : 0,
    getBoolean(form, 'is_active') ? 1 : 0,
  ];

  if (id) {
    run(
      `UPDATE catering_packages SET name = ?, slug = ?, image = ?, price_paise = ?, description = ?, badge = ?,
       show_on_home = ?, is_active = ? WHERE id = ?`,
      [...values, id],
    );
    return id;
  }

  const packageId = run(
    `INSERT INTO catering_packages (name, slug, image, price_paise, description, badge, show_on_home, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  ).lastId;

  const sectionId = run(
    `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
     VALUES (?, 'Starters & Appetizers', 1, 0, 3, 1)`,
    [packageId],
  ).lastId;
  run(`INSERT INTO menu_categories (section_id, title, sort) VALUES (?, 'Signature Bites', 1)`, [sectionId]);

  return packageId;
}

export function deleteCatering(id: number): void {
  run('DELETE FROM catering_packages WHERE id = ?', [id]);
}

export function toggleCatering(id: number): void {
  run('UPDATE catering_packages SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

export function toggleCateringHome(id: number): void {
  run('UPDATE catering_packages SET show_on_home = CASE show_on_home WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
}

export function addMenuSection(packageId: number, form: FormData | null): void {
  const title = getString(form, 'title');
  if (!title) return;
  const sectionId = run(
    `INSERT INTO menu_sections (package_id, title, has_category, available_items, max_selection, sort)
     VALUES (?, ?, 1, 0, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM menu_sections WHERE package_id = ?))`,
    [packageId, title, getInt(form, 'max_selection', 3), packageId],
  ).lastId;
  run(`INSERT INTO menu_categories (section_id, title, sort) VALUES (?, ?, 1)`, [sectionId, `${title} selection`]);
}

export function updateMenuSection(sectionId: number, form: FormData | null): void {
  const title = getString(form, 'title');
  const maxSelection = getInt(form, 'max_selection', 3);
  if (!title) return;
  run('UPDATE menu_sections SET title = ?, max_selection = ? WHERE id = ?', [title, maxSelection, sectionId]);
}

export function deleteMenuSection(sectionId: number): void {
  run('DELETE FROM menu_sections WHERE id = ?', [sectionId]);
}

export function addMenuItem(sectionId: number, form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  const category = one<{ id: number }>(
    'SELECT id FROM menu_categories WHERE section_id = ? ORDER BY sort, id LIMIT 1',
    [sectionId],
  );
  const categoryId =
    category?.id ??
    run(`INSERT INTO menu_categories (section_id, title, sort) VALUES (?, 'Selection', 1)`, [sectionId]).lastId;
  run('INSERT INTO menu_items (category_id, name, is_available) VALUES (?, ?, 1)', [categoryId, name]);
}

export function updateMenuItem(itemId: number, form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  run('UPDATE menu_items SET name = ? WHERE id = ?', [name, itemId]);
}

export function deleteMenuItem(itemId: number): void {
  run('DELETE FROM menu_items WHERE id = ?', [itemId]);
}

export function toggleMenuItem(itemId: number): void {
  run('UPDATE menu_items SET is_available = CASE is_available WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [itemId]);
}

export function addGuestPricing(packageId: number, form: FormData | null): void {
  const guestCount = getInt(form, 'guest_count', 0);
  const price = parseMoneyToPaise(getString(form, 'price_per_plate'));
  if (guestCount <= 0 || price <= 0) return;
  run(
    `INSERT INTO guest_pricing (package_id, guest_count, price_per_plate_paise, sort)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM guest_pricing WHERE package_id = ?))`,
    [packageId, guestCount, price, packageId],
  );
}

export function deleteGuestPricing(id: number): void {
  run('DELETE FROM guest_pricing WHERE id = ?', [id]);
}

export function addPackageOption(table: 'catering_features' | 'banner_features', packageId: number, form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  run(`INSERT INTO ${table} (package_id, name) VALUES (?, ?)`, [packageId, name]);
}

export function deletePackageOption(table: 'catering_features' | 'banner_features', id: number): void {
  run(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

/* ============================ Gallery ============================ */

export function listGalleryAdmin(options?: { page?: number; perPage?: number; categoryId?: number }) {
  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.max(1, Math.min(100, options?.perPage ?? 18));
  const categoryId = options?.categoryId ?? 0;

  const categories = all<{ id: number; name: string; is_active: number; item_count: number }>(
    `SELECT gc.id, gc.name, gc.is_active,
            (SELECT COUNT(*) FROM gallery_items gi WHERE gi.category_id = gc.id) AS item_count
     FROM gallery_categories gc ORDER BY gc.sort, gc.name`,
  );

  const whereClause = categoryId > 0 ? 'WHERE category_id = ?' : '';
  const queryParams = categoryId > 0 ? [categoryId] : [];

  const totalRow = one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM gallery_items ${whereClause}`,
    queryParams,
  );
  const totalCount = Number(totalRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * perPage;

  const items = all<{ id: number; title: string; image: string; category_id: number; is_active: number; created_at: string }>(
    `SELECT id, title, image, category_id, is_active, created_at FROM gallery_items ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...queryParams, perPage, offset],
  );

  const storageUsage = getStorageUsage('gallery');

  return {
    categories,
    items,
    pagination: {
      page: currentPage,
      perPage,
      totalCount,
      totalPages,
      selectedCategory: categoryId,
      startItem: totalCount === 0 ? 0 : offset + 1,
      endItem: Math.min(offset + items.length, totalCount),
    },
    storageUsage,
  };
}

export function addGalleryCategory(form: FormData | null): void {
  const name = getString(form, 'name');
  if (!name) return;
  const slug = uniqueSlug(name, (candidate) =>
    Boolean(one<{ id: number }>('SELECT id FROM gallery_categories WHERE slug = ?', [candidate])),
  );
  run('INSERT INTO gallery_categories (name, slug, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM gallery_categories))', [
    name,
    slug,
  ]);
}

export function deleteGalleryCategory(id: number): void {
  run('DELETE FROM gallery_categories WHERE id = ?', [id]);
}

export function toggleGalleryCategory(id: number): boolean {
  run('UPDATE gallery_categories SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  return Boolean(one<{ is_active: number }>('SELECT is_active FROM gallery_categories WHERE id = ?', [id])?.is_active);
}

export interface GalleryUploadFailure {
  filename: string;
  error: string;
}

export interface GalleryBatchUploadResult {
  uploaded: number;
  itemIds: number[];
  failures: GalleryUploadFailure[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

function imageFilesFrom(form: FormData | null, fields: string[]): File[] {
  if (!form) return [];

  const files: File[] = [];

  for (const field of fields) {
    for (const value of form.getAll(field)) {
      if (typeof value === 'string') continue;
      if (typeof Blob === 'undefined' || !(value instanceof Blob) || !value.size) continue;
      files.push(value as File);
    }
  }

  return files;
}

function galleryCaption(title: string, file: File, index: number, total: number): string {
  if (title) return total > 1 ? `${title} ${index + 1}` : title;

  const base = file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  return base || `Gallery image ${index + 1}`;
}

export async function batchUploadGalleryAdmin(
  form: FormData | null,
): Promise<GalleryBatchUploadResult> {
  const categoryId = getInt(form, 'category_id', 0);
  if (!categoryId) throw new Error('Choose a gallery category.');

  const category = one<{ id: number }>('SELECT id FROM gallery_categories WHERE id = ?', [categoryId]);
  if (!category) throw new Error('The selected gallery category no longer exists.');

  const title = getString(form, 'title');
  const files = imageFilesFrom(form, ['images', 'image', 'files']);
  const pasted = getString(form, 'image_path');
  const result: GalleryBatchUploadResult = { uploaded: 0, itemIds: [], failures: [] };

  if (files.length === 0) {
    if (!pasted) throw new Error('Choose at least one image to upload.');

    const itemId = run(
      'INSERT INTO gallery_items (category_id, title, image, is_active) VALUES (?, ?, ?, 1)',
      [categoryId, title || 'Gallery image', pasted],
    ).lastId;

    return { uploaded: 1, itemIds: [itemId], failures: [] };
  }

  for (const [index, file] of files.entries()) {
    const itemId = run(
      'INSERT INTO gallery_items (category_id, title, image, is_active) VALUES (?, ?, ?, 1)',
      [categoryId, galleryCaption(title, file, index, files.length), ''],
    ).lastId;

    try {
      const stored = await imageStorage.uploadImage(file, {
        entityType: 'gallery_item',
        entityId: itemId,
        slot: 'primary',
        filename: file.name,
      });

      run('UPDATE gallery_items SET image = ? WHERE id = ?', [stored.publicUrl, itemId]);
      result.uploaded += 1;
      result.itemIds.push(itemId);
    } catch (error) {
      run('DELETE FROM gallery_items WHERE id = ?', [itemId]);
      result.failures.push({
        filename: file.name || `image-${index + 1}`,
        error: errorMessage(error),
      });
    }
  }

  if (result.uploaded === 0) {
    throw new Error(result.failures[0]?.error ?? 'The images could not be uploaded.');
  }

  return result;
}

export interface GalleryImageUpdate {
  itemId: number;
  image: string;
}

export async function replaceGalleryItemAdmin(
  itemId: number,
  form: FormData | null,
): Promise<GalleryImageUpdate> {
  const item = one<{ id: number; image: string }>(
    'SELECT id, image FROM gallery_items WHERE id = ?',
    [itemId],
  );

  if (!item) throw new Error('Gallery image not found.');

  const uploaded = await saveUploadedImage(form, 'image', 'gallery', {
    entityType: 'gallery_item',
    entityId: itemId,
    slot: 'primary',
  });
  const pasted = getString(form, 'image_path');
  const image = uploaded ?? (pasted && pasted !== item.image ? pasted : '');

  if (!image) throw new Error('Choose a replacement image.');

  run('UPDATE gallery_items SET image = ? WHERE id = ?', [image, itemId]);
  return { itemId, image };
}

export function saveGalleryItemTitle(id: number, form: FormData | null): string {
  const title = getString(form, 'title');
  if (!title) throw new Error('Add a caption for the image.');
  run('UPDATE gallery_items SET title = ? WHERE id = ?', [title, id]);
  return title;
}

export function saveGalleryItemCategory(id: number, form: FormData | null): number {
  const categoryId = getInt(form, 'category_id', 0);
  if (!categoryId) throw new Error('Choose a valid category.');
  run('UPDATE gallery_items SET category_id = ? WHERE id = ?', [categoryId, id]);
  return categoryId;
}

export function deleteGalleryItem(id: number): void {
  run('DELETE FROM gallery_items WHERE id = ?', [id]);
}

export function toggleGalleryItem(id: number): boolean {
  run('UPDATE gallery_items SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  return Boolean(one<{ is_active: number }>('SELECT is_active FROM gallery_items WHERE id = ?', [id])?.is_active);
}

/* ============================ Catalog media ============================ */

export interface CatalogImageUpdate {
  id: number;
  image: string;
}

async function updateCatalogImageAdmin(
  table: 'mandaps' | 'stages' | 'equipment_items',
  entityType: ImageEntityType,
  label: string,
  id: number,
  form: FormData | null,
): Promise<CatalogImageUpdate> {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid ${label.toLowerCase()} id.`);

  const row = one<{ id: number; image: string | null }>(
    `SELECT id, image FROM ${table} WHERE id = ?`,
    [id],
  );
  if (!row) throw new Error(`${label} not found.`);

  const uploaded = await saveUploadedImage(form, 'image', table, {
    entityType,
    entityId: id,
    slot: 'primary',
  });
  const pasted = getString(form, 'image_path');
  const image = uploaded ?? (pasted && pasted !== (row.image ?? '') ? pasted : '');

  if (!image) throw new Error(`Choose an image for this ${label.toLowerCase()}.`);

  run(`UPDATE ${table} SET image = ? WHERE id = ?`, [image, id]);
  return { id, image };
}

export function updateMandapImageAdmin(id: number, form: FormData | null): Promise<CatalogImageUpdate> {
  return updateCatalogImageAdmin('mandaps', 'mandap', 'Mandap', id, form);
}

export function updateStageImageAdmin(id: number, form: FormData | null): Promise<CatalogImageUpdate> {
  return updateCatalogImageAdmin('stages', 'stage', 'Stage', id, form);
}

export function updateEquipmentImageAdmin(id: number, form: FormData | null): Promise<CatalogImageUpdate> {
  return updateCatalogImageAdmin('equipment_items', 'equipment', 'Equipment item', id, form);
}

/* ============================ Storage ============================ */

export interface StorageCategoryCard {
  category: StorageCategory;
  label: string;
  description: string;
  usage: QuotaUsage;
  formattedUsed: string;
  formattedLimit: string;
  formattedAvailable: string;
  formattedReserved: string;
  activeCount: number;
  pendingDeletionCount: number;
  level: QuotaWarningLevel;
  usagePercent: number;
}

export interface StorageDashboardData {
  gallery: StorageCategoryCard;
  asset: StorageCategoryCard;
  usage: StorageUsageSummary;
  pendingDeletionCount: number;
  driver: StorageDriver;
  isConfigured: boolean;
}

function storageCategoryCounts(category: StorageCategory): {
  active: number;
  pendingDeletion: number;
} {
  const row = one<{ active: number | null; pending_deletion: number | null }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
       COALESCE(SUM(CASE WHEN status = 'pending_deletion' THEN 1 ELSE 0 END), 0) AS pending_deletion
     FROM storage_objects
     WHERE storage_category = ?`,
    [category],
  );

  return {
    active: Number(row?.active ?? 0),
    pendingDeletion: Number(row?.pending_deletion ?? 0),
  };
}

function storageCategoryCard(
  category: StorageCategory,
  label: string,
  description: string,
  usage: QuotaUsage,
): StorageCategoryCard {
  const counts = storageCategoryCounts(category);

  return {
    category,
    label,
    description,
    usage,
    formattedUsed: formatBytes(usage.usedBytes),
    formattedLimit: formatBytes(usage.limitBytes),
    formattedAvailable: formatBytes(usage.availableBytes),
    formattedReserved: formatBytes(usage.reservedBytes),
    activeCount: counts.active,
    pendingDeletionCount: counts.pendingDeletion,
    level: usage.level,
    usagePercent: usage.usagePercent,
  };
}

export function loadStorageDashboard(): StorageDashboardData {
  const usage = imageStorage.getStorageUsage();

  return {
    gallery: storageCategoryCard(
      'gallery',
      'Gallery',
      'Photos published to the public gallery.',
      usage.gallery,
    ),
    asset: storageCategoryCard(
      'asset',
      'Other Assets',
      'Mandaps, stages, equipment and site branding.',
      usage.asset,
    ),
    usage,
    pendingDeletionCount: usage.pendingDeletionCount,
    driver: usage.driver,
    isConfigured: usage.isConfigured,
  };
}

export async function reconcileStorageAdmin(): Promise<ReconcileStorageReport> {
  return imageStorage.reconcileStorage();
}

export async function retryCleanupAdmin(limit?: number): Promise<RetryPendingDeletionsReport> {
  return imageStorage.retryPendingDeletions(limit === undefined ? {} : { limit });
}

/* ============================ Customers ============================ */

export function listCustomers(query?: string) {
  const like = `%${query ?? ''}%`;
  const where = query ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : '';
  const params = query ? [like, like, like] : [];
  return all<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    created_at: string;
    booking_count: number;
    total_spend: number;
  }>(
    `SELECT c.id, c.name, c.phone, c.email, c.created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS booking_count,
            (SELECT COALESCE(SUM(b.total_amount), 0) FROM bookings b WHERE b.customer_id = c.id AND b.status IN ('pending','confirmed')) AS total_spend
     FROM customers c ${where} ORDER BY c.id DESC LIMIT 200`,
    params,
  );
}

export function loadCustomerAdmin(id: number) {
  const customer = one<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    created_at: string;
    username: string | null;
  }>(
    `SELECT c.*, u.username AS username FROM customers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [id],
  );
  if (!customer) return null;

  const bookings = all<{
    id: number;
    event_date: string | null;
    event_type: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    'SELECT id, event_date, event_type, total_amount, status, created_at FROM bookings WHERE customer_id = ? ORDER BY id DESC',
    [id],
  );

  return { customer, bookings };
}

/* ============================ Inquiries ============================ */

export function listInquiries(status?: string) {
  const where = status && status !== 'all' ? 'WHERE status = ?' : '';
  const params = where ? [status] : [];
  return all<{
    id: number;
    name: string;
    phone: string;
    email: string;
    event_type: string;
    event_date: string | null;
    guest_count: number | null;
    message: string;
    status: string;
    created_at: string;
  }>(`SELECT * FROM contact_inquiries ${where} ORDER BY id DESC LIMIT 200`, params);
}

export function updateInquiryStatus(id: number, status: string): void {
  if (!['new', 'contacted', 'closed'].includes(status)) return;
  run('UPDATE contact_inquiries SET status = ? WHERE id = ?', [status, id]);
}

export function deleteInquiry(id: number): void {
  run('DELETE FROM contact_inquiries WHERE id = ?', [id]);
}

/* ============================ Content ============================ */

export async function loadContentAdmin() {
  const d1 = getD1Client();
  let siteSettings: any = null;
  let seoSettings: any[] = [];
  try {
    const sRes = await d1.query('SELECT * FROM site_settings WHERE id = ? LIMIT 1', ['global']);
    siteSettings = sRes.results?.[0] || null;
    const seoRes = await d1.query('SELECT * FROM seo_settings ORDER BY page_key ASC');
    seoSettings = seoRes.results || [];
  } catch (err) {
    console.warn('[D1] loadContentAdmin query error:', (err as Error).message);
  }

  // Load the 6 pages from D1
  const pagesContent = await listAllPageContent(true);

  // Load mandaps from D1 with location fields
  const mandaps = await getMandaps(true);

  // Load all video previews (published and draft) from D1
  const videoPreviews = await getVideoPreviews({ onlyPublished: false });

  const homepage = one<{ hero_title: string; hero_description: string; hero_image: string | null }>(
    'SELECT hero_title, hero_description, hero_image FROM homepage WHERE id = 1',
  );
  const features = all<{ id: number; icon: string; title: string; description: string }>(
    'SELECT id, icon, title, description FROM homepage_features ORDER BY sort, id',
  );
  const pages = all<{ key: string; hero_title: string; hero_subtitle: string; hero_badge: string; hero_image: string | null }>(
    'SELECT key, hero_title, hero_subtitle, hero_badge, hero_image FROM page_settings ORDER BY key',
  );
  const contact = one<{ address: string; phone: string; email: string }>(
    'SELECT address, phone, email FROM contact_info WHERE id = 1',
  );
  return { homepage, features, pages, contact, siteSettings, seoSettings, pagesContent, mandaps, videoPreviews };
}

export async function saveSiteSettings(form: FormData | null): Promise<void> {
  const d1 = getD1Client();
  const name = getString(form, 'name');
  const tagline = getString(form, 'tagline');
  const short_description = getString(form, 'short_description');
  const phone = getString(form, 'phone');
  const whatsapp = getString(form, 'whatsapp');
  const email = getString(form, 'email');
  const address = getString(form, 'address');
  const venue_address = getString(form, 'venue_address');
  const business_hours = getString(form, 'business_hours');
  const announcement_text = getString(form, 'announcement_text');
  const google_maps_url = getString(form, 'google_maps_url');
  const latStr = getString(form, 'latitude');
  const lonStr = getString(form, 'longitude');
  const latitude = latStr ? parseFloat(latStr) : null;
  const longitude = lonStr ? parseFloat(lonStr) : null;
  const footer_text = getString(form, 'footer_text');
  const contact_buttons_enabled = form?.has('contact_buttons_enabled') ? 1 : 0;
  const primary_color = getString(form, 'primary_color') || '#721224';
  const gold_bright = getString(form, 'gold_bright') || '#e0b868';

  const coordCheck = validateCoordinates(latitude, longitude);
  if (!coordCheck.valid) {
    throw new Error(coordCheck.error);
  }

  if (google_maps_url && !validateExternalUrl(google_maps_url)) {
    throw new Error('Google Maps URL must be a valid HTTP or HTTPS link.');
  }

  await d1.query(
    `UPDATE site_settings SET
       name = COALESCE(NULLIF(?, ''), name),
       tagline = COALESCE(NULLIF(?, ''), tagline),
       short_description = COALESCE(NULLIF(?, ''), short_description),
       phone = COALESCE(NULLIF(?, ''), phone),
       whatsapp = COALESCE(NULLIF(?, ''), whatsapp),
       email = COALESCE(NULLIF(?, ''), email),
       address = COALESCE(NULLIF(?, ''), address),
       venue_address = COALESCE(NULLIF(?, ''), venue_address),
       business_hours = COALESCE(NULLIF(?, ''), business_hours),
       announcement_text = COALESCE(NULLIF(?, ''), announcement_text),
       google_maps_url = COALESCE(?, google_maps_url),
       latitude = ?,
       longitude = ?,
       footer_text = COALESCE(?, footer_text),
       contact_buttons_enabled = ?,
       primary_color = ?,
       gold_bright = ?,
       updated_at = datetime('now')
     WHERE id = 'global'`,
    [
      name,
      tagline,
      short_description,
      phone,
      whatsapp,
      email,
      address,
      venue_address,
      business_hours,
      announcement_text,
      google_maps_url,
      latitude,
      longitude,
      footer_text,
      contact_buttons_enabled,
      primary_color,
      gold_bright,
    ],
  );
  invalidateContentCache();
}

export async function savePageAdmin(form: FormData | null): Promise<void> {
  const page_key = getString(form, 'page_key');
  if (!page_key) throw new Error('Page key is required.');

  const uploaded = await saveUploadedImage(form, 'banner_image', 'content');
  const banner_image_url = (uploaded ?? getString(form, 'banner_image_path')) || undefined;

  const title = getString(form, 'title');
  const subtitle = getString(form, 'subtitle');
  const description = getString(form, 'description');
  const seo_title = getString(form, 'seo_title');
  const seo_description = getString(form, 'seo_description');
  const banner_enabled = form?.has('banner_enabled');
  const published = form?.has('published');

  const badge = getString(form, 'badge');
  const overlay = getString(form, 'overlay') || 'dark';
  const textAlignment = getString(form, 'text_alignment') || 'left';
  const primaryCtaLabel = getString(form, 'primary_cta_label');
  const primaryCtaUrl = getString(form, 'primary_cta_url');
  const secondaryCtaLabel = getString(form, 'secondary_cta_label');
  const secondaryCtaUrl = getString(form, 'secondary_cta_url');

  const content_json: Record<string, any> = {
    badge,
    overlay,
    textAlignment,
  };
  if (primaryCtaLabel || primaryCtaUrl) {
    content_json.primaryCta = { label: primaryCtaLabel, url: primaryCtaUrl };
  }
  if (secondaryCtaLabel || secondaryCtaUrl) {
    content_json.secondaryCta = { label: secondaryCtaLabel, url: secondaryCtaUrl };
  }

  await savePageContent(page_key, {
    title,
    subtitle,
    description,
    banner_image_url,
    banner_enabled,
    content_json,
    seo_title,
    seo_description,
    og_image_url: banner_image_url,
    published,
  });
}

export async function saveMandapLocationAdmin(form: FormData | null): Promise<void> {
  const id = getInt(form, 'mandap_id');
  if (!id) throw new Error('Mandap ID is required.');

  const location_name = getString(form, 'location_name');
  const address = getString(form, 'address');
  const latStr = getString(form, 'latitude');
  const lonStr = getString(form, 'longitude');
  const latitude = latStr ? parseFloat(latStr) : null;
  const longitude = lonStr ? parseFloat(lonStr) : null;
  const google_maps_url = getString(form, 'google_maps_url');
  const directions_url = getString(form, 'directions_url');
  const show_location = form?.has('show_location');

  await saveMandapLocation(id, {
    location_name,
    address,
    latitude,
    longitude,
    google_maps_url,
    directions_url,
    show_location,
  });
}

export async function saveVideoPreviewAdmin(form: FormData | null): Promise<void> {
  const videoIdNum = getInt(form, 'id') || undefined;
  const title = getString(form, 'title');
  const description = getString(form, 'description');
  const video_url = getString(form, 'video_url');
  const aspect_ratio_str = getString(form, 'aspect_ratio');
  const aspect_ratio = aspect_ratio_str === '9:16' ? '9:16' : aspect_ratio_str === '16:9' ? '16:9' : undefined;

  // Optional custom thumbnail upload via Filebase
  const uploaded = await saveUploadedImage(form, 'custom_thumbnail', 'content');
  const thumbnail_url = (uploaded ?? getString(form, 'thumbnail_url')) || undefined;

  const is_featured = form?.has('is_featured');
  const is_published = form?.has('is_published');
  const sort_order = getInt(form, 'sort_order') || 0;

  await saveVideoPreview({
    id: videoIdNum,
    title,
    description,
    video_url,
    thumbnail_url,
    aspect_ratio,
    is_featured,
    is_published,
    sort_order,
  });
}

export async function deleteVideoPreviewAdmin(form: FormData | null): Promise<void> {
  const id = getInt(form, 'video_id');
  if (!id) throw new Error('Video preview ID is required for deletion.');
  await deleteVideoPreview(id);
}

export async function toggleVideoPreviewAdmin(form: FormData | null): Promise<boolean> {
  const id = getInt(form, 'video_id');
  if (!id) throw new Error('Video preview ID is required to toggle.');
  return await toggleVideoPreview(id);
}

export async function saveSeoSettings(form: FormData | null): Promise<void> {
  const d1 = getD1Client();
  const page_key = getString(form, 'page_key');
  const title = getString(form, 'title');
  const description = getString(form, 'description');
  const canonical_url = getString(form, 'canonical_url');
  const og_image_url = getString(form, 'og_image_url');

  if (page_key) {
    await d1.query(
      `UPDATE seo_settings SET
         title = ?,
         description = ?,
         canonical_url = ?,
         og_image_url = COALESCE(NULLIF(?, ''), og_image_url),
         updated_at = datetime('now')
       WHERE page_key = ?`,
      [title, description, canonical_url, og_image_url, page_key],
    );
    invalidateContentCache();
  }
}

export async function saveHomepage(form: FormData | null): Promise<void> {
  const uploaded = await saveUploadedImage(form, 'hero_image', 'content');
  const image = (uploaded ?? getString(form, 'hero_image_path')) || null;
  const title = getString(form, 'hero_title');
  const description = getString(form, 'hero_description');

  run('UPDATE homepage SET hero_title = ?, hero_description = ?, hero_image = ? WHERE id = 1', [
    title,
    description,
    image,
  ]);

  try {
    const d1 = getD1Client();
    await d1.query(
      `UPDATE homepage_sections SET
         title = ?,
         description = ?,
         image_url = COALESCE(?, image_url),
         updated_at = datetime('now')
       WHERE section_key = 'hero'`,
      [title, description, image],
    );
    invalidateContentCache();
  } catch {}
}

export function addHomeFeature(form: FormData | null): void {
  const title = getString(form, 'title');
  if (!title) return;
  run(
    `INSERT INTO homepage_features (icon, title, description, sort)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM homepage_features))`,
    [getString(form, 'icon') || 'sparkles', title, getString(form, 'description')],
  );
  invalidateContentCache();
}

export function deleteHomeFeature(id: number): void {
  run('DELETE FROM homepage_features WHERE id = ?', [id]);
  invalidateContentCache();
}

export async function savePageSettings(form: FormData | null): Promise<void> {
  const uploaded = await saveUploadedImage(form, 'hero_image', 'content');
  const image = (uploaded ?? getString(form, 'hero_image_path')) || null;

  const existing = one<{ hero_image: string | null }>('SELECT hero_image FROM page_settings WHERE key = ?', [
    getString(form, 'key'),
  ]);

  run(
    `UPDATE page_settings SET hero_title = ?, hero_subtitle = ?, hero_badge = ?, hero_image = ? WHERE key = ?`,
    [
      getString(form, 'hero_title'),
      getString(form, 'hero_subtitle'),
      getString(form, 'hero_badge'),
      image ?? existing?.hero_image ?? null,
      getString(form, 'key'),
    ],
  );
  invalidateContentCache();
}

export async function saveContactInfo(form: FormData | null): Promise<void> {
  const address = getString(form, 'address');
  const phone = getString(form, 'phone');
  const email = getString(form, 'email');

  run('UPDATE contact_info SET address = ?, phone = ?, email = ? WHERE id = 1', [
    address,
    phone,
    email,
  ]);

  try {
    const d1 = getD1Client();
    await d1.query(
      `UPDATE site_settings SET
         address = ?,
         phone = ?,
         email = ?,
         updated_at = datetime('now')
       WHERE id = 'global'`,
      [address, phone, email],
    );
    invalidateContentCache();
  } catch {}
}

/* ============================ Event enquiries ============================ */

export interface EventEnquiryRow {
  id: number;
  reference_code: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  event_type: string;
  event_date: string;
  end_date: string | null;
  event_time: string | null;
  venue_location: string;
  guest_count: number;
  budget_range: string;
  requires_rooms: number;
  room_count: number;
  accommodation_notes: string;
  decoration_notes: string;
  preferred_contact: string;
  status: string;
  created_at: string;
}

export interface EnquiryLineItemRow {
  id: number;
  enquiry_id: number;
  item_type: string;
  catalogue_item_id: number | null;
  item_name_snapshot: string;
  quantity: number;
  standard_dimensions_snapshot: string;
  requested_length_ft: number | null;
  requested_width_ft: number | null;
  requested_height_ft: number | null;
  specifications: string;
  notes: string;
}

export function listEventEnquiries(filters: { status?: string; query?: string } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  if (filters.query) {
    const like = `%${filters.query}%`;
    clauses.push(
      '(reference_code LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR event_type LIKE ? OR venue_location LIKE ?)',
    );
    params.push(like, like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return all<EventEnquiryRow>(
    `SELECT id, reference_code, customer_name, customer_phone, customer_email, event_type,
            event_date, end_date, event_time, venue_location, guest_count, budget_range,
            requires_rooms, room_count, accommodation_notes, decoration_notes, preferred_contact,
            status, created_at
     FROM event_enquiries
     ${where}
     ORDER BY id DESC LIMIT 200`,
    params,
  );
}

export function loadEventEnquiry(id: number): { enquiry: EventEnquiryRow; lines: EnquiryLineItemRow[] } | null {
  const enquiry = one<EventEnquiryRow>('SELECT * FROM event_enquiries WHERE id = ?', [id]);
  if (!enquiry) return null;

  const lines = all<EnquiryLineItemRow>(
    'SELECT * FROM enquiry_line_items WHERE enquiry_id = ? ORDER BY id',
    [id],
  );

  return { enquiry, lines };
}

export function updateEventEnquiryStatus(id: number, status: string): void {
  if (!['new', 'reviewing', 'quoted', 'confirmed', 'archived'].includes(status)) {
    throw new Error('Invalid enquiry status.');
  }
  run('UPDATE event_enquiries SET status = ? WHERE id = ?', [status, id]);
}

/* ============================ Payments & Refunds Admin ============================ */

export async function loadPaymentsAdmin(filters?: {
  search?: string;
  status?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}) {
  const metrics = await getPaymentMetrics();
  const listResult = await listPayments(filters);
  return { metrics, payments: listResult.payments, total: listResult.total };
}

export async function loadPaymentDetailAdmin(paymentId: number) {
  const payment = await getPaymentById(paymentId);
  if (!payment) return null;

  const booking = await getBookingById(payment.booking_id);
  const refunds = await getRefundsByPaymentId(payment.id);
  const invoice = await getInvoiceByPaymentId(payment.id);

  const neon = getNeonClient();
  const custRes = payment.customer_id
    ? await neon.query<CustomerRow>('SELECT * FROM customers WHERE id = $1 LIMIT 1', [payment.customer_id])
    : { rows: [] };
  const customer = custRes.rows[0] || null;

  const webhooksRes = await neon.query<PaymentWebhookEventRow>(
    `SELECT * FROM payment_webhook_events 
     WHERE provider_event_id = $1 OR raw_payload LIKE $2
     ORDER BY id DESC LIMIT 10`,
    [payment.provider_payment_id || '', `%${payment.internal_transaction_reference}%`]
  );

  return {
    payment,
    booking,
    customer,
    refunds,
    invoice,
    webhookEvents: webhooksRes.rows,
  };
}

export async function processRefundAdmin(
  paymentId: number,
  amountPaise: number,
  reason: string,
  adminUserId?: number
) {
  const paymentService = getPaymentService();
  return paymentService.initiateRefund({
    paymentId,
    amountPaise,
    reason,
    initiatedByUserId: adminUserId,
  });
}


