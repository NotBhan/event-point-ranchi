import { all, one, run } from '../../core/db';
import {
  countBookings,
  countContactInquiries,
  countCustomers,
  deleteContactInquiry,
  countEventEnquiries,
  findUserById,
  getBookingStats,
  getBookingsForCustomer,
  getCustomerWithUsername,
  getBookingForEnquiry,
  getBookingsForEnquiryIds,
  getEnquiryLineItemsForIds,
  listEnquiryQuotations,
  getEventEnquiryWithItems,
  getHallBookingActivity,
  getRecentBookings,
  getUpcomingBookings,
  listBookingsPage,
  listContactInquiriesPage,
  listCustomersPage,
  listEventEnquiriesPage,
  setBookingStatus,
  updateContactInquiryStatus as updateContactInquiryStatusNeon,
} from '../../core/operational/service';
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
import { getActivePointer, listReleases } from '../../core/content-storage/publication';
import { listDrafts, getEditableDocument, getDraft } from '../../core/content-storage/drafts';
import { getContentFallbackCounters } from '../../core/content-storage/read';
import { isPageId, PAGE_IDS, type PageId } from '../../core/content-storage/schema';
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
  type EnquiryBookingSummary,
} from '../../core/operational/service';
import { getNeonClient } from '../../core/operational/neon-client';
import { paymentsEnabled } from '../../core/features';

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

/**
 * Booking aggregates for the dashboard. Bookings are operational records, so
 * they are read from Neon — the same store the booking API writes to.
 */
export async function loadDashboard() {
  const localCounts = one<{
    halls: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM halls WHERE is_active = 1) AS halls`,
  ) ?? { halls: 0 };

  const bookingStats = await getBookingStats();
  const counts = {
    bookings: bookingStats.bookings,
    pending: bookingStats.pending,
    confirmed: bookingStats.confirmed,
    revenue: bookingStats.revenue,
    halls: Number(localCounts.halls ?? 0),
    packages: 0,
    customers: await countCustomers(),
    inquiries: await countContactInquiries('new'),
  };

  // The catering catalogue lives in D1 (publishable), not in the local SQLite copy.
  counts.packages = await visibleCateringPackageCount();

  const recentBookings = await getRecentBookings(8);
  const upcoming = await getUpcomingBookings(6);

  // Hall usage comes from booking_items in Neon; hall names stay in the
  // catalogue copy, so they are joined in memory.
  const hallActivity = await getHallBookingActivity();
  const hallNames = new Map(
    all<{ id: number; name: string }>('SELECT id, name FROM halls').map((hall) => [Number(hall.id), hall.name]),
  );
  const topHalls = hallActivity
    .map((entry) => ({
      name: hallNames.get(entry.hallId) ?? `Hall #${entry.hallId}`,
      bookings: entry.bookings,
      revenue: entry.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return { counts, recentBookings, upcoming, topHalls };
}

/* ============================ Bookings ============================ */

/**
 * Admin booking list, read from the authoritative operational database.
 */
export async function listBookings(
  filters: { status?: string; query?: string } = {},
  paging: { page?: number; perPage?: number } = {},
) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalCount = await countBookings(filters);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;
  const items = await listBookingsPage(filters, { limit: perPage, offset });

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
}

export async function updateBookingStatus(id: number, status: string): Promise<void> {
  if (!['draft', 'pending', 'confirmed', 'completed', 'cancelled', 'closed'].includes(status)) {
    throw new Error('Invalid booking status.');
  }

  const updated = await setBookingStatus(id, status);
  if (!updated) throw new Error(`Booking #${id} was not found.`);
}

/* ============================ Halls ============================ */

export async function listHallsAdmin(paging: { page?: number; perPage?: number } = {}) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalRow = one<{ count: number }>('SELECT COUNT(*) AS count FROM halls');
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  // Booking counts come from the operational store; hall records stay in the
  // catalogue copy, so the two are merged in memory.
  const hallActivity = new Map((await getHallBookingActivity()).map((entry) => [entry.hallId, entry.bookings]));

  const rows = all<{
    id: number;
    name: string;
    slug: string;
    image: string | null;
    price_paise: number;
    capacity: number;
    location: string;
    is_active: number;
    is_featured: number;
  }>(
    `SELECT h.id, h.name, h.slug, h.image, h.price_paise, h.capacity, h.location, h.is_active, h.is_featured
     FROM halls h
     ORDER BY h.is_active DESC, h.id
     LIMIT ? OFFSET ?`,
    [perPage, offset],
  );

  const items = rows.map((hall) => ({ ...hall, booking_count: hallActivity.get(Number(hall.id)) ?? 0 }));

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

export async function listCustomers(query?: string, paging: { page?: number; perPage?: number } = {}) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalCount = await countCustomers(query);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;
  const items = await listCustomersPage(query, { limit: perPage, offset });

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
}

export async function loadCustomerAdmin(id: number) {
  const customer = await getCustomerWithUsername(id);
  if (!customer) return null;

  const bookings = await getBookingsForCustomer(id);

  return { customer, bookings };
}

/* ============================ Inquiries ============================ */

export async function listInquiries(status?: string, paging: { page?: number; perPage?: number } = {}) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalCount = await countContactInquiries(status);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;
  const items = await listContactInquiriesPage(status, { limit: perPage, offset });

  return { items, pagination: buildPagination(requestedPage, perPage, totalCount, items.length) };
}

export async function updateInquiryStatus(id: number, status: string): Promise<void> {
  if (!['new', 'contacted', 'closed'].includes(status)) {
    throw new Error('Invalid inquiry status.');
  }

  const updated = await updateContactInquiryStatusNeon(id, status);
  if (!updated) throw new Error(`Inquiry #${id} was not found.`);
}

export async function deleteInquiry(id: number): Promise<void> {
  const deleted = await deleteContactInquiry(id);
  if (!deleted) throw new Error(`Inquiry #${id} was not found.`);
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
  'documents',
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
  options: { origin?: string; page?: string } = {},
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

    // Object-storage publication state (the D1→Filebase pipeline).
    let objectStore: {
      configured: boolean;
      error?: string;
      activeVersion: string;
      activeManifest: string;
      updatedAt: string | null;
      releases: Array<{
        id: string;
        siteVersion: string;
        status: string;
        publishedByName: string;
        createdAt: string | null;
        completedAt: string | null;
        error: string;
        rolledBackTo: string;
      }>;
    } = { configured: false, activeVersion: '', activeManifest: '', updatedAt: null, releases: [] };

    try {
      const [pointer, releases] = await Promise.all([getActivePointer(), listReleases(8)]);
      objectStore = {
        configured: true,
        activeVersion: pointer.siteVersion,
        activeManifest: pointer.manifestKey,
        updatedAt: pointer.updatedAt,
        releases: releases.map((release) => ({
          id: release.id,
          siteVersion: release.siteVersion,
          status: release.status,
          publishedByName: release.publishedByName,
          createdAt: release.createdAt,
          completedAt: release.completedAt,
          error: release.error,
          rolledBackTo: release.rolledBackTo,
        })),
      };
    } catch (error) {
      objectStore.error = error instanceof Error ? error.message : String(error);
    }

    return {
      tab,
      publications,
      activePublication,
      liveManifest,
      objectStore,
      publishConfig: {
        deployHookConfigured: deployHookConfigured(),
        vercelConfigured: vercelConfig().configured,
        dashboardUrl: dashboardUrl(),
      },
    };
  }

  if (tab === 'documents') {
    const requested = options.page ?? 'home';
    const pageId: PageId = isPageId(requested) ? requested : 'home';

    const [document, draft, drafts, pointer] = await Promise.all([
      getEditableDocument(pageId),
      getDraft(pageId),
      listDrafts(),
      getActivePointer().catch(() => null),
    ]);

    return {
      tab,
      contentPageId: pageId,
      contentPageIds: [...PAGE_IDS],
      contentDocument: document,
      contentDraft: draft,
      draftPageIds: drafts.map((entry) => entry.pageId),
      contentPublishedVersion: pointer?.siteVersion ?? '',
      fallbackCounters: getContentFallbackCounters().snapshot(),
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
  // BOOLEAN in Neon PostgreSQL, INTEGER in the local SQLite fallback.
  requires_rooms: boolean | number;
  room_count: number;
  accommodation_notes: string;
  decoration_notes: string;
  preferred_contact: string;
  status: string;
  accepted_by?: number | null;
  accepted_at?: string | Date | null;
  rejection_reason?: string | null;
  pricing_status?: 'fully_priced' | 'partially_priced' | 'quotation_required';
  priced_subtotal_paise?: number;
  additional_services?: string;
  accepted_quotation_id?: number | null;
  // TIMESTAMPTZ from Neon arrives as a Date; the fallback returns a string.
  created_at: string | Date;
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
  catalogue_unit_price_paise?: number | null;
  catalogue_subtotal_paise?: number | null;
  pricing_status?: 'priced' | 'on_request';
  metadata_json?: string;
}

export interface AdminEnquiryListRow extends EventEnquiryRow {
  lines: EnquiryLineItemRow[];
  booking: EnquiryBookingSummary | null;
}

/**
 * New-enquiries inbox. The default `active` filter contains only enquiries
 * still requiring an admin decision; accepted/rejected records are available
 * through the history filters.
 */
export async function listNewEnquiries(
  filters: { status?: string; query?: string } = {},
  paging: { page?: number; perPage?: number } = {},
) {
  const perPage = Math.max(1, Math.min(100, paging.perPage ?? 25));
  const requestedPage = Math.max(1, paging.page ?? 1);

  const totalCount = await countEventEnquiries(filters);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const { items } = await listEventEnquiriesPage(filters, { limit: perPage, offset });
  const enquiries = items as unknown as EventEnquiryRow[];
  const ids = enquiries.map((enquiry) => Number(enquiry.id));

  const [allLines, bookingMap] = await Promise.all([
    getEnquiryLineItemsForIds(ids),
    getBookingsForEnquiryIds(ids),
  ]);

  const linesByEnquiry = new Map<number, EnquiryLineItemRow[]>();
  for (const line of allLines) {
    const list = linesByEnquiry.get(Number(line.enquiry_id)) ?? [];
    list.push(line as unknown as EnquiryLineItemRow);
    linesByEnquiry.set(Number(line.enquiry_id), list);
  }

  const rows: AdminEnquiryListRow[] = enquiries.map((enquiry) => ({
    ...enquiry,
    lines: linesByEnquiry.get(Number(enquiry.id)) ?? [],
    booking: bookingMap.get(Number(enquiry.id)) ?? null,
  }));

  return {
    items: rows,
    pagination: buildPagination(requestedPage, perPage, totalCount, rows.length),
  };
}

export async function loadNewEnquiry(id: number): Promise<{
  enquiry: EventEnquiryRow;
  lines: EnquiryLineItemRow[];
  booking: EnquiryBookingSummary | null;
  acceptedBy: string | null;
  quotations: Array<{
    quotation: Awaited<ReturnType<typeof listEnquiryQuotations>>[number]['quotation'];
    lines: Awaited<ReturnType<typeof listEnquiryQuotations>>[number]['lines'];
    preparedByName: string | null;
    acceptedByName: string | null;
  }>;
  latestPreparedQuotation:
    | {
        quotation: Awaited<ReturnType<typeof listEnquiryQuotations>>[number]['quotation'];
        lines: Awaited<ReturnType<typeof listEnquiryQuotations>>[number]['lines'];
        preparedByName: string | null;
        acceptedByName: string | null;
      }
    | null;
} | null> {
  const result = await getEventEnquiryWithItems(id);
  if (!result) return null;

  const [booking, quotations] = await Promise.all([
    getBookingForEnquiry(id),
    listEnquiryQuotations(id),
  ]);
  const acceptedByUser = result.enquiry.accepted_by
    ? await findUserById(Number(result.enquiry.accepted_by))
    : null;

  const userIds = [
    ...new Set(
      quotations
        .flatMap((entry) => [entry.quotation.prepared_by, entry.quotation.accepted_by])
        .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
    ),
  ];

  const userNames = new Map<number, string>();
  if (userIds.length > 0) {
    const placeholders = userIds.map((_, index) => `$${index + 1}`).join(', ');
    const users = await getNeonClient().query<{ id: number; first_name: string; username: string }>(
      `SELECT id, first_name, username FROM users WHERE id IN (${placeholders})`,
      userIds,
    );
    for (const user of users.rows) {
      userNames.set(Number(user.id), user.first_name || user.username);
    }
  }

  const withNames = quotations.map((entry) => ({
    ...entry,
    preparedByName: entry.quotation.prepared_by
      ? userNames.get(Number(entry.quotation.prepared_by)) ?? null
      : null,
    acceptedByName: entry.quotation.accepted_by
      ? userNames.get(Number(entry.quotation.accepted_by)) ?? null
      : null,
  }));

  return {
    enquiry: result.enquiry as unknown as EventEnquiryRow,
    lines: result.lines as unknown as EnquiryLineItemRow[],
    booking,
    acceptedBy: acceptedByUser?.first_name || acceptedByUser?.username || null,
    quotations: withNames,
    latestPreparedQuotation:
      withNames.find((entry) => entry.quotation.status === 'prepared') ?? null,
  };
}

/* ============================ Payments & Refunds Admin ============================ */

export async function loadPaymentsAdmin(filters?: {
  search?: string;
  status?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}) {
  if (!paymentsEnabled()) throw new Error('Payments are not available during the core launch.');
  const [metrics, listResult] = await Promise.all([getPaymentMetrics(), listPayments(filters)]);
  return { metrics, payments: listResult.payments, total: listResult.total };
}

export async function loadPaymentDetailAdmin(paymentId: number) {
  if (!paymentsEnabled()) throw new Error('Payments are not available during the core launch.');
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
  if (!paymentsEnabled()) throw new Error('Payments are not available during the core launch.');
  const { getPaymentService } = await import('../../core/payment/payment-service');
  const paymentService = getPaymentService();
  return paymentService.initiateRefund({
    paymentId,
    amountPaise,
    reason,
    initiatedByUserId: adminUserId,
  });
}


