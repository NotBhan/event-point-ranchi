import { all, one, run } from '../../core/db';
import { buildPagination, getBoolean, getInt, getString, parseMoneyToPaise, uniqueSlug, uniqueSlugAsync } from '../../core/http';
import * as catalog from '../../core/content/catalog-store';
import { formatBytes } from '../../core/storage/config';
import type { StorageDriver } from '../../core/storage/filebase';
import type { QuotaUsage, QuotaWarningLevel, StorageCategory } from '../../core/storage/quota';
import {
  imageStorage,
  type ReconcileStorageReport,
  type RetryPendingDeletionsReport,
  type StorageUsageSummary,
} from '../../core/storage/service';
import { getStorageUsage, saveUploadedImage, UploadError } from '../../core/uploads';
import { getD1Client } from '../../core/content/d1-client';
import {
  dashboardUrl,
  deployHookConfigured,
  fetchLiveManifest,
  getActivePublication,
  listPublications,
  vercelConfig,
} from '../../core/operational/publication-service';
import {
  invalidateContentCache,
  getPageContent,
  getMandaps,
  getSiteSettingsRowCached,
  getSeoSettingsRowsCached,
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

// The catering count lives in D1 (a remote round trip). A KPI does not need to
// be live to the second, so cache it briefly and keep the dashboard fast.
let packagesCountCache: { value: number; at: number } | null = null;

async function visibleCateringPackageCount(): Promise<number> {
  if (packagesCountCache && Date.now() - packagesCountCache.at < 60_000) {
    return packagesCountCache.value;
  }
  const value = await catalog
    .countVisibleCateringPackages()
    .catch(() => packagesCountCache?.value ?? 0);
  packagesCountCache = { value, at: Date.now() };
  return value;
}

export async function loadDashboard() {
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
      0 AS packages,
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

  // The catering catalogue lives in D1 (publishable), not in the local SQLite copy.
  counts.packages = await visibleCateringPackageCount();

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

export function listBookings(
  filters: { status?: string; query?: string } = {},
  paging: { page?: number; perPage?: number } = {},
) {
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
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalRow = one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM bookings b JOIN customers c ON c.id = b.customer_id ${where}`,
    params,
  );
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = all<{
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
     ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
}

export function updateBookingStatus(id: number, status: string): void {
  if (!['draft', 'pending', 'confirmed', 'cancelled'].includes(status)) return;
  run('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);
}

export function deleteBooking(id: number): void {
  run('DELETE FROM bookings WHERE id = ?', [id]);
}

/* ============================ Halls ============================ */

export function listHallsAdmin(paging: { page?: number; perPage?: number } = {}) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalRow = one<{ count: number }>('SELECT COUNT(*) AS count FROM halls');
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = all<{
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
            COALESCE(bh.booking_count, 0) AS booking_count
     FROM halls h
     LEFT JOIN (
       SELECT hall_id, COUNT(*) AS booking_count FROM booking_halls GROUP BY hall_id
     ) bh ON bh.hall_id = h.id
     ORDER BY h.is_active DESC, h.id
     LIMIT ? OFFSET ?`,
    [perPage, offset],
  );

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
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

/** D1 rows use their own column names; the admin pages keep the legacy view model. */
function toCateringAdminItem(
  row: catalog.CateringPackageRow & { section_count?: number; item_count?: number },
) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    badge: row.badge,
    image: row.image_url,
    price_paise: row.price_per_plate_paise,
    is_active: row.is_visible,
    show_on_home: row.show_on_home,
    section_count: Number(row.section_count ?? 0),
    item_count: Number(row.item_count ?? 0),
  };
}

export async function listCateringAdmin(paging: { page?: number; perPage?: number } = {}) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  let result = await catalog.listCateringAdminRows(requestedPage, perPage);
  const totalPages = Math.max(1, Math.ceil(result.totalCount / perPage));
  const currentPage = Math.min(requestedPage, totalPages);
  if (currentPage !== requestedPage) {
    result = await catalog.listCateringAdminRows(currentPage, perPage);
  }

  const items = result.items.map(toCateringAdminItem);
  return {
    items,
    pagination: buildPagination(currentPage, perPage, result.totalCount, items.length),
  };
}

export async function loadCateringAdmin(id: number) {
  const data = await catalog.loadCateringPackageAdmin(id);
  if (!data) return null;

  return {
    package: toCateringAdminItem(data.package),
    features: data.features,
    bannerFeatures: data.bannerFeatures,
    pricing: data.pricing,
    sections: data.sections.map((section) => ({
      id: section.id,
      title: section.title,
      max_selection: section.max_selection,
      items: section.items,
    })),
  };
}

export async function saveCatering(form: FormData | null, id?: number): Promise<number> {
  const name = getString(form, 'name');
  if (!name) throw new Error('Package name is required.');

  const existingId = id ?? 0;
  const slug = await uniqueSlugAsync(getString(form, 'slug') || name, (candidate) =>
    catalog.cateringSlugTaken(candidate, existingId),
  );

  const uploaded = await saveUploadedImage(form, 'image', 'catering');
  const input: catalog.CateringPackageInput = {
    name,
    slug,
    imageUrl: (uploaded ?? getString(form, 'image_path')) || null,
    pricePaise: parseMoneyToPaise(getString(form, 'price')),
    description: getString(form, 'description'),
    badge: getString(form, 'badge'),
    showOnHome: getBoolean(form, 'show_on_home') ? 1 : 0,
    isVisible: getBoolean(form, 'is_active') ? 1 : 0,
  };

  if (id) {
    await catalog.updateCateringPackage(id, input);
    return id;
  }

  const packageId = await catalog.insertCateringPackage(input);
  await catalog.seedDefaultMenuSection(packageId);

  return packageId;
}

export async function deleteCatering(id: number): Promise<void> {
  await catalog.deleteCateringPackage(id);
}

export async function toggleCatering(id: number): Promise<void> {
  await catalog.toggleCateringVisibility(id);
}

export async function toggleCateringHome(id: number): Promise<void> {
  await catalog.toggleCateringHome(id);
}

export async function addMenuSection(packageId: number, form: FormData | null): Promise<void> {
  const title = getString(form, 'title');
  if (!title) return;
  const sectionId = await catalog.insertMenuSection(packageId, title, getInt(form, 'max_selection', 3));
  await catalog.insertMenuCategory(sectionId, `${title} selection`);
}

export async function updateMenuSection(sectionId: number, form: FormData | null): Promise<void> {
  const title = getString(form, 'title');
  const maxSelection = getInt(form, 'max_selection', 3);
  if (!title) return;
  await catalog.updateMenuSection(sectionId, title, maxSelection);
}

export async function deleteMenuSection(sectionId: number): Promise<void> {
  await catalog.deleteMenuSection(sectionId);
}

export async function addMenuItem(sectionId: number, form: FormData | null): Promise<void> {
  const name = getString(form, 'name');
  if (!name) return;
  const categoryId =
    (await catalog.findFirstMenuCategory(sectionId)) ?? (await catalog.insertMenuCategory(sectionId, 'Selection'));
  await catalog.insertMenuItem(categoryId, name);
}

export async function updateMenuItem(itemId: number, form: FormData | null): Promise<void> {
  const name = getString(form, 'name');
  if (!name) return;
  await catalog.updateMenuItemName(itemId, name);
}

export async function deleteMenuItem(itemId: number): Promise<void> {
  await catalog.deleteMenuItem(itemId);
}

export async function toggleMenuItem(itemId: number): Promise<void> {
  await catalog.toggleMenuItemAvailability(itemId);
}

export async function addGuestPricing(packageId: number, form: FormData | null): Promise<void> {
  const guestCount = getInt(form, 'guest_count', 0);
  const price = parseMoneyToPaise(getString(form, 'price_per_plate'));
  if (guestCount <= 0 || price <= 0) return;
  await catalog.insertGuestPricing(packageId, guestCount, price);
}

export async function deleteGuestPricing(id: number): Promise<void> {
  await catalog.deleteGuestPricing(id);
}

export async function addPackageOption(
  table: 'catering_features' | 'banner_features',
  packageId: number,
  form: FormData | null,
): Promise<void> {
  const name = getString(form, 'name');
  if (!name) return;
  await catalog.insertPackageOption(table, packageId, name);
}

export async function deletePackageOption(
  table: 'catering_features' | 'banner_features',
  id: number,
): Promise<void> {
  await catalog.deletePackageOption(table, id);
}

/* ============================ Gallery ============================ */

function toGalleryAdminItem(row: catalog.GalleryItemRow) {
  return {
    id: row.id,
    title: row.caption,
    image: row.image_url,
    category_id: row.category_id,
    is_active: row.is_visible,
    created_at: row.created_at,
  };
}

export async function listGalleryAdmin(options?: { page?: number; perPage?: number; categoryId?: number }) {
  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.max(1, Math.min(100, options?.perPage ?? 18));
  const categoryId = options?.categoryId ?? 0;

  let result = await catalog.listGalleryAdminRows({ page, perPage, categoryId });
  const totalPages = Math.max(1, Math.ceil(result.totalCount / perPage));
  const currentPage = Math.min(page, totalPages);
  if (currentPage !== page) {
    result = await catalog.listGalleryAdminRows({ page: currentPage, perPage, categoryId });
  }

  const items = result.items.map(toGalleryAdminItem);
  const offset = (currentPage - 1) * perPage;

  return {
    categories: result.categories.map((category) => ({
      id: category.id,
      name: category.name,
      is_active: category.is_visible,
      item_count: Number(category.item_count),
    })),
    items,
    pagination: {
      page: currentPage,
      perPage,
      totalCount: result.totalCount,
      totalPages,
      selectedCategory: categoryId,
      startItem: result.totalCount === 0 ? 0 : offset + 1,
      endItem: Math.min(offset + items.length, result.totalCount),
    },
    storageUsage: getStorageUsage('gallery'),
  };
}

export async function addGalleryCategory(form: FormData | null): Promise<void> {
  const name = getString(form, 'name');
  if (!name) return;
  const slug = await uniqueSlugAsync(name, (candidate) => catalog.galleryCategorySlugTaken(candidate));
  await catalog.insertGalleryCategory(name, slug);
}

export async function deleteGalleryCategory(id: number): Promise<void> {
  await catalog.deleteGalleryCategory(id);
}

export async function toggleGalleryCategory(id: number): Promise<boolean> {
  return catalog.toggleGalleryCategoryVisibility(id);
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

  const category = await catalog.findGalleryCategory(categoryId);
  if (!category) throw new Error('The selected gallery category no longer exists.');

  const title = getString(form, 'title');
  const files = imageFilesFrom(form, ['images', 'image', 'files']);
  const pasted = getString(form, 'image_path');
  const result: GalleryBatchUploadResult = { uploaded: 0, itemIds: [], failures: [] };

  if (files.length === 0) {
    if (!pasted) throw new Error('Choose at least one image to upload.');

    const itemId = await catalog.insertGalleryItem({
      categoryId,
      caption: title || 'Gallery image',
      imageUrl: pasted,
    });

    return { uploaded: 1, itemIds: [itemId], failures: [] };
  }

  for (const [index, file] of files.entries()) {
    const itemId = await catalog.insertGalleryItem({
      categoryId,
      caption: galleryCaption(title, file, index, files.length),
      imageUrl: '',
    });

    try {
      const stored = await imageStorage.uploadImage(file, {
        entityType: 'gallery_item',
        entityId: itemId,
        slot: 'primary',
        filename: file.name,
      });

      await catalog.updateGalleryItemImage(itemId, stored.publicUrl);
      result.uploaded += 1;
      result.itemIds.push(itemId);
    } catch (error) {
      await catalog.deleteGalleryItem(itemId);
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
  const item = await catalog.findGalleryItem(itemId);

  if (!item) throw new Error('Gallery image not found.');

  const uploaded = await saveUploadedImage(form, 'image', 'gallery', {
    entityType: 'gallery_item',
    entityId: itemId,
    slot: 'primary',
  });
  const pasted = getString(form, 'image_path');
  const image = uploaded ?? (pasted && pasted !== item.image_url ? pasted : '');

  if (!image) throw new Error('Choose a replacement image.');

  await catalog.updateGalleryItemImage(itemId, image);
  return { itemId, image };
}

export async function saveGalleryItemTitle(id: number, form: FormData | null): Promise<string> {
  const title = getString(form, 'title');
  if (!title) throw new Error('Add a caption for the image.');
  await catalog.updateGalleryItemCaption(id, title);
  return title;
}

export async function saveGalleryItemCategory(id: number, form: FormData | null): Promise<number> {
  const categoryId = getInt(form, 'category_id', 0);
  if (!categoryId) throw new Error('Choose a valid category.');
  await catalog.updateGalleryItemCategory(id, categoryId);
  return categoryId;
}

export async function deleteGalleryItem(id: number): Promise<void> {
  await catalog.deleteGalleryItem(id);
}

export async function toggleGalleryItem(id: number): Promise<boolean> {
  return catalog.toggleGalleryItemVisibility(id);
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

/** One grouped query for both storage categories instead of one per card. */
function storageCountsByCategory(): Record<StorageCategory, { active: number; pendingDeletion: number }> {
  const counts: Record<StorageCategory, { active: number; pendingDeletion: number }> = {
    gallery: { active: 0, pendingDeletion: 0 },
    asset: { active: 0, pendingDeletion: 0 },
  };

  const rows = all<{ storage_category: StorageCategory; active: number | null; pending_deletion: number | null }>(
    `SELECT storage_category,
            COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN status = 'pending_deletion' THEN 1 ELSE 0 END), 0) AS pending_deletion
     FROM storage_objects
     GROUP BY storage_category`,
  );

  for (const row of rows) {
    if (row.storage_category === 'gallery' || row.storage_category === 'asset') {
      counts[row.storage_category] = {
        active: Number(row.active ?? 0),
        pendingDeletion: Number(row.pending_deletion ?? 0),
      };
    }
  }

  return counts;
}

function storageCategoryCard(
  category: StorageCategory,
  label: string,
  description: string,
  usage: QuotaUsage,
  counts: { active: number; pendingDeletion: number },
): StorageCategoryCard {
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
  const counts = storageCountsByCategory();

  return {
    gallery: storageCategoryCard(
      'gallery',
      'Gallery',
      'Photos published to the public gallery.',
      usage.gallery,
      counts.gallery,
    ),
    asset: storageCategoryCard(
      'asset',
      'Other Assets',
      'Mandaps, stages, equipment and site branding.',
      usage.asset,
      counts.asset,
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

export function listCustomers(query?: string, paging: { page?: number; perPage?: number } = {}) {
  const like = `%${query ?? ''}%`;
  const where = query ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : '';
  const params = query ? [like, like, like] : [];

  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalRow = one<{ count: number }>(`SELECT COUNT(*) AS count FROM customers c ${where}`, params);
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = all<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    created_at: string;
    booking_count: number;
    total_spend: number;
  }>(
    `SELECT c.id, c.name, c.phone, c.email, c.created_at,
            COALESCE(b.booking_count, 0) AS booking_count,
            COALESCE(b.total_spend, 0) AS total_spend
     FROM customers c
     LEFT JOIN (
       SELECT customer_id,
              COUNT(*) AS booking_count,
              COALESCE(SUM(CASE WHEN status IN ('pending','confirmed') THEN total_amount ELSE 0 END), 0) AS total_spend
       FROM bookings
       GROUP BY customer_id
     ) b ON b.customer_id = c.id
     ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
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

export function listInquiries(status?: string, paging: { page?: number; perPage?: number } = {}) {
  const where = status && status !== 'all' ? 'WHERE status = ?' : '';
  const params = where ? [status] : [];
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalRow = one<{ count: number }>(`SELECT COUNT(*) AS count FROM contact_inquiries ${where}`, params);
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = all<{
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
  }>(`SELECT * FROM contact_inquiries ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, perPage, offset]);

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
}

export function updateInquiryStatus(id: number, status: string): void {
  if (!['new', 'contacted', 'closed'].includes(status)) return;
  run('UPDATE contact_inquiries SET status = ? WHERE id = ?', [status, id]);
}

export function deleteInquiry(id: number): void {
  run('DELETE FROM contact_inquiries WHERE id = ?', [id]);
}

/* ============================ Content ============================ */

export const CONTENT_STUDIO_TABS = [
  'brand',
  'locations',
  'videos',
  'seo',
  'features',
  'publish',
  'page-home',
  'page-mandaps',
  'page-gallery',
  'page-catering',
  'page-stages',
  'page-equipment',
] as const;

export type ContentStudioTab = (typeof CONTENT_STUDIO_TABS)[number];

export function parseContentStudioTab(raw: string | null | undefined): ContentStudioTab {
  const value = (raw ?? '').trim();
  return (CONTENT_STUDIO_TABS as readonly string[]).includes(value) ? (value as ContentStudioTab) : 'brand';
}

/**
 * Loads data for a single Content Studio tab. Each tab previously fetched
 * everything (~11 sequential D1 round trips) and rendered every panel; the
 * active tab is now the only thing fetched and rendered server-side.
 */
export async function loadContentAdmin(
  tab: ContentStudioTab = 'brand',
  options: { origin?: string } = {},
) {
  if (tab === 'brand') {
    let siteSettings: any = null;
    try {
      siteSettings = await getSiteSettingsRowCached();
    } catch (err) {
      console.warn('[D1] loadContentAdmin query error:', (err as Error).message);
    }
    return { tab, siteSettings };
  }

  if (tab === 'locations') {
    const mandaps = await getMandaps(true);
    return { tab, mandaps };
  }

  if (tab === 'videos') {
    const videoPreviews = await getVideoPreviews({ onlyPublished: false });
    return { tab, videoPreviews };
  }

  if (tab === 'seo') {
    let seoSettings: any[] = [];
    try {
      seoSettings = await getSeoSettingsRowsCached();
    } catch (err) {
      console.warn('[D1] loadContentAdmin SEO query error:', (err as Error).message);
    }
    return { tab, seoSettings };
  }

  if (tab === 'features') {
    const features = all<{ id: number; icon: string; title: string; description: string }>(
      'SELECT id, icon, title, description FROM homepage_features ORDER BY sort, id',
    );
    return { tab, features };
  }

  if (tab === 'publish') {
    const [publications, activePublication, liveManifest] = await Promise.all([
      listPublications(8),
      getActivePublication(),
      options.origin ? fetchLiveManifest(options.origin) : Promise.resolve(null),
    ]);
    return {
      tab,
      publications,
      activePublication,
      liveManifest,
      publishConfig: {
        deployHookConfigured: deployHookConfigured(),
        vercelConfigured: vercelConfig().configured,
        dashboardUrl: dashboardUrl(),
      },
    };
  }

  const pageKey = tab.slice('page-'.length);
  const pageContent = await getPageContent(pageKey, true);
  return { tab, pagesContent: [pageContent] };
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

export function listEventEnquiries(
  filters: { status?: string; query?: string } = {},
  paging: { page?: number; perPage?: number } = {},
) {
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
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalRow = one<{ count: number }>(`SELECT COUNT(*) AS count FROM event_enquiries ${where}`, params);
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = all<EventEnquiryRow>(
    `SELECT id, reference_code, customer_name, customer_phone, customer_email, event_type,
            event_date, end_date, event_time, venue_location, guest_count, budget_range,
            requires_rooms, room_count, accommodation_notes, decoration_notes, preferred_contact,
            status, created_at
     FROM event_enquiries
     ${where}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
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
  const [metrics, listResult] = await Promise.all([getPaymentMetrics(), listPayments(filters)]);
  return { metrics, payments: listResult.payments, total: listResult.total };
}

export async function loadPaymentDetailAdmin(paymentId: number) {
  const payment = await getPaymentById(paymentId);
  if (!payment) return null;

  const neon = getNeonClient();
  const [booking, refunds, invoice, custRes, webhooksRes] = await Promise.all([
    getBookingById(payment.booking_id),
    getRefundsByPaymentId(payment.id),
    getInvoiceByPaymentId(payment.id),
    payment.customer_id
      ? neon.query<CustomerRow>('SELECT * FROM customers WHERE id = $1 LIMIT 1', [payment.customer_id])
      : Promise.resolve({ rows: [] as CustomerRow[], rowCount: 0 }),
    neon.query<PaymentWebhookEventRow>(
      `SELECT * FROM payment_webhook_events 
       WHERE provider_event_id = $1 OR raw_payload LIKE $2
       ORDER BY id DESC LIMIT 10`,
      [payment.provider_payment_id || '', `%${payment.internal_transaction_reference}%`]
    ),
  ]);
  const customer = custRes.rows[0] || null;

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


