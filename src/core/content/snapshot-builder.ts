import { createHash } from 'node:crypto';
import type {
  CateringPackage,
  FurnitureCategory,
  FurnitureItem,
  GalleryCategory,
  HomepageSection,
  MandapItem,
  PageContent,
  SeoSettings,
  ServiceItem,
  SiteSettings,
  StageItem,
  VideoPlatform,
  VideoPreviewItem,
} from './types';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type ContentRow,
  type PublicContentRows,
  type PublicContentSnapshot,
  type SnapshotCounts,
  type SnapshotGalleryItem,
  type SnapshotManifest,
} from './snapshot-types';

export interface SnapshotRowFetcher {
  batch<T = ContentRow>(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<Array<{ results: T[] }>>;
}

export class SnapshotValidationError extends Error {
  public readonly problems: string[];

  constructor(problems: string[]) {
    super(`Content snapshot validation failed:\n- ${problems.join('\n- ')}`);
    this.name = 'SnapshotValidationError';
    this.problems = problems;
  }
}

const REQUIRED_PAGE_KEYS = ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'] as const;
const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Explicit field allowlists. Row columns are copied one by one (never spread),
 * so a future column on these tables can never leak private data into the
 * public snapshot bundle.
 */
function mapSettings(row: ContentRow | null): SiteSettings | null {
  if (!row) return null;
  return {
    id: String(row.id ?? 'global'),
    name: String(row.name ?? ''),
    legal_name: String(row.legal_name ?? ''),
    tagline: String(row.tagline ?? ''),
    short_description: String(row.short_description ?? ''),
    logo_url: String(row.logo_url ?? ''),
    favicon_url: String(row.favicon_url ?? ''),
    phone: String(row.phone ?? ''),
    whatsapp: String(row.whatsapp ?? ''),
    email: String(row.email ?? ''),
    address: String(row.address ?? ''),
    venue_address: String(row.venue_address ?? ''),
    business_hours: String(row.business_hours ?? ''),
    social_links_json: String(row.social_links_json ?? '[]'),
    primary_color: String(row.primary_color ?? '#721224'),
    gold_bright: String(row.gold_bright ?? '#e0b868'),
    font_preset: String(row.font_preset ?? 'heritage'),
    default_title: String(row.default_title ?? ''),
    default_description: String(row.default_description ?? ''),
    og_image_url: String(row.og_image_url ?? ''),
    currency: String(row.currency ?? 'INR'),
    locale: String(row.locale ?? 'en-IN'),
    announcement_enabled: Number(row.announcement_enabled ?? 1),
    announcement_text: String(row.announcement_text ?? ''),
    announcement_location: String(row.announcement_location ?? ''),
    announcement_phone: String(row.announcement_phone ?? ''),
    google_maps_url: String(row.google_maps_url ?? ''),
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    footer_text: String(row.footer_text ?? ''),
    contact_buttons_enabled: Number(row.contact_buttons_enabled ?? 1),
    maintenance_enabled: Number(row.maintenance_enabled ?? 0),
    maintenance_message: String(row.maintenance_message ?? ''),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function mapHomeSection(row: ContentRow): HomepageSection {
  return {
    id: String(row.id ?? ''),
    section_key: String(row.section_key ?? ''),
    section_type: String(row.section_type ?? ''),
    title: String(row.title ?? ''),
    subtitle: String(row.subtitle ?? ''),
    description: String(row.description ?? ''),
    image_url: String(row.image_url ?? ''),
    cta_label: String(row.cta_label ?? ''),
    cta_url: String(row.cta_url ?? ''),
    badge: String(row.badge ?? ''),
    is_visible: Number(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
    config_json: typeof row.config_json === 'string' ? row.config_json : '{}',
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function parseJsonArray<T>(raw: unknown): T[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Fetches every public content table in a single D1 batch request (no N+1
 * round trips, no repeated connections). Only published/visible rows are read.
 */
export async function fetchPublicContentRows(client: SnapshotRowFetcher): Promise<PublicContentRows> {
  const statements = [
    { sql: "SELECT * FROM site_settings WHERE id = 'global' LIMIT 1" },
    { sql: 'SELECT * FROM page_content WHERE published = 1 ORDER BY page_key ASC' },
    { sql: 'SELECT * FROM seo_settings ORDER BY page_key ASC' },
    // Every ordering carries an id tiebreaker: D1 does not guarantee a stable
    // order for equal sort_order values, and an unstable order would change the
    // content version for identical content.
    { sql: 'SELECT * FROM homepage_sections WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM services WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM mandaps WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM mandap_gallery ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM stages WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM stage_gallery ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM furniture_categories WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM furniture_items WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM catering_packages WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM gallery_categories WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM gallery_items WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC' },
    { sql: 'SELECT * FROM video_previews WHERE is_published = 1 ORDER BY sort_order ASC, id DESC' },
  ];

  const results = await client.batch(statements);
  const rowsAt = (index: number): ContentRow[] => results[index]?.results ?? [];

  return {
    settings: rowsAt(0)[0] ?? null,
    pages: rowsAt(1),
    seo: rowsAt(2),
    homeSections: rowsAt(3),
    services: rowsAt(4),
    mandaps: rowsAt(5),
    mandapGallery: rowsAt(6),
    stages: rowsAt(7),
    stageGallery: rowsAt(8),
    furnitureCategories: rowsAt(9),
    furnitureItems: rowsAt(10),
    cateringPackages: rowsAt(11),
    galleryCategories: rowsAt(12),
    galleryItems: rowsAt(13),
    videos: rowsAt(14),
  };
}

function mapPage(row: ContentRow): PageContent {
  return {
    id: Number(row.id ?? 0),
    page_key: String(row.page_key ?? ''),
    title: String(row.title ?? ''),
    subtitle: String(row.subtitle ?? ''),
    description: String(row.description ?? ''),
    banner_image_url: String(row.banner_image_url ?? ''),
    banner_enabled: Boolean(row.banner_enabled ?? 1),
    content_json: parseJsonObject(row.content_json),
    seo_title: String(row.seo_title ?? ''),
    seo_description: String(row.seo_description ?? ''),
    og_image_url: String(row.og_image_url ?? ''),
    published: Boolean(row.published ?? 1),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function mapSeo(row: ContentRow): SeoSettings {
  return {
    id: Number(row.id ?? 0),
    page_key: String(row.page_key ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    canonical_url: String(row.canonical_url ?? ''),
    og_image_url: String(row.og_image_url ?? ''),
  };
}

function mapService(row: ContentRow): ServiceItem {
  return {
    id: Number(row.id ?? 0),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    badge: String(row.badge ?? ''),
    image_url: String(row.image_url ?? ''),
    features: parseJsonArray<string>(row.features_json),
    is_visible: Boolean(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}

function mapMandap(row: ContentRow, gallery: MandapItem['gallery']): MandapItem {
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    category: String(row.category ?? 'Traditional Royal'),
    length_ft: Number(row.length_ft ?? 16),
    width_ft: Number(row.width_ft ?? 16),
    height_ft: Number(row.height_ft ?? 12),
    dimension_unit: String(row.dimension_unit ?? 'ft'),
    material_specs: String(row.material_specs ?? ''),
    price_starting_paise: Number(row.price_starting_paise ?? 0),
    capacity: Number(row.capacity ?? 0),
    features: parseJsonArray<string>(row.features_json),
    image_url: String(row.image_url ?? ''),
    location_name: String(row.location_name ?? ''),
    address: String(row.address ?? ''),
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
    google_maps_url: String(row.google_maps_url ?? ''),
    directions_url: String(row.directions_url ?? ''),
    show_location: Boolean(row.show_location),
    gallery,
    is_featured: Boolean(row.is_featured),
    is_visible: Boolean(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}

function mapStage(row: ContentRow, gallery: StageItem['gallery']): StageItem {
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    style_category: String(row.style_category ?? 'Royal Reception'),
    length_ft: Number(row.length_ft ?? 24),
    width_ft: Number(row.width_ft ?? 16),
    height_ft: Number(row.height_ft ?? 14),
    dimension_unit: String(row.dimension_unit ?? 'ft'),
    decoration_notes: String(row.decoration_notes ?? ''),
    price_starting_paise: Number(row.price_starting_paise ?? 0),
    image_url: String(row.image_url ?? ''),
    gallery,
    is_featured: Boolean(row.is_featured),
    is_visible: Boolean(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}

function mapFurnitureCategory(row: ContentRow): FurnitureCategory {
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    icon: String(row.icon ?? 'chair'),
    sort_order: Number(row.sort_order ?? 0),
    is_visible: Boolean(row.is_visible ?? 1),
  };
}

function mapFurnitureItem(row: ContentRow): FurnitureItem {
  return {
    id: Number(row.id ?? 0),
    category_id: Number(row.category_id ?? 0),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    image_url: String(row.image_url ?? ''),
    price_paise: Number(row.price_paise ?? 0),
    pricing_unit: String(row.pricing_unit ?? 'per item'),
    dimensions: String(row.dimensions ?? ''),
    specifications: String(row.specifications ?? ''),
    min_quantity: Number(row.min_quantity ?? 1),
    default_quantity: Number(row.default_quantity ?? 10),
    is_visible: Boolean(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}

function mapCateringPackage(row: ContentRow): CateringPackage {
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    badge: String(row.badge ?? ''),
    image_url: String(row.image_url ?? ''),
    price_per_plate_paise: Number(row.price_per_plate_paise ?? 0),
    features: parseJsonArray<string>(row.features_json),
    menu_sections: parseJsonArray<Record<string, any>>(row.menu_sections_json),
    guest_pricing: parseJsonArray<Record<string, any>>(row.guest_pricing_json),
    show_on_home: Boolean(row.show_on_home),
    is_visible: Boolean(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}

function mapGalleryCategory(row: ContentRow): GalleryCategory {
  return {
    id: Number(row.id ?? 0),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    sort_order: Number(row.sort_order ?? 0),
    is_visible: Boolean(row.is_visible ?? 1),
  };
}

function mapGalleryItem(row: ContentRow, categorySlug: string): SnapshotGalleryItem {
  return {
    id: Number(row.id ?? 0),
    category_id: Number(row.category_id ?? 0),
    caption: String(row.caption ?? ''),
    image_url: String(row.image_url ?? ''),
    alt_text: String(row.alt_text ?? row.caption ?? ''),
    is_visible: Boolean(row.is_visible ?? 1),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at ?? ''),
    category_slug: categorySlug,
  };
}

function mapVideo(row: ContentRow): VideoPreviewItem {
  return {
    id: Number(row.id ?? 0),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    platform: (row.platform ?? 'youtube') as VideoPlatform,
    video_url: String(row.video_url ?? ''),
    video_id: String(row.video_id ?? ''),
    thumbnail_url: String(row.thumbnail_url ?? ''),
    aspect_ratio: row.aspect_ratio === '9:16' ? '9:16' : '16:9',
    is_featured: Boolean(row.is_featured),
    is_published: Boolean(row.is_published ?? 1),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/**
 * Pure transformation from raw D1 rows into the public snapshot. No I/O, so it
 * can be unit tested and reused by the publish-readiness check.
 */
export function buildSnapshot(rows: PublicContentRows): PublicContentSnapshot {
  const mandapGallery = new Map<number, MandapItem['gallery']>();
  for (const g of rows.mandapGallery) {
    const mandapId = Number(g.mandap_id ?? 0);
    if (!mandapGallery.has(mandapId)) mandapGallery.set(mandapId, []);
    mandapGallery.get(mandapId)!.push({
      id: Number(g.id ?? 0),
      image_url: String(g.image_url ?? ''),
      caption: String(g.caption ?? ''),
      sort_order: Number(g.sort_order ?? 0),
    });
  }

  const stageGallery = new Map<number, StageItem['gallery']>();
  for (const g of rows.stageGallery) {
    const stageId = Number(g.stage_id ?? 0);
    if (!stageGallery.has(stageId)) stageGallery.set(stageId, []);
    stageGallery.get(stageId)!.push({
      id: Number(g.id ?? 0),
      image_url: String(g.image_url ?? ''),
      caption: String(g.caption ?? ''),
      sort_order: Number(g.sort_order ?? 0),
    });
  }

  const galleryCategories = rows.galleryCategories.map(mapGalleryCategory);
  const gallerySlugById = new Map(galleryCategories.map((c) => [c.id, c.slug]));

  return {
    settings: mapSettings(rows.settings),
    pages: rows.pages.map(mapPage),
    seo: rows.seo.map(mapSeo),
    homeSections: rows.homeSections.map(mapHomeSection),
    services: rows.services.map(mapService),
    mandaps: rows.mandaps.map((row) => mapMandap(row, mandapGallery.get(Number(row.id ?? 0)) ?? [])),
    stages: rows.stages.map((row) => mapStage(row, stageGallery.get(Number(row.id ?? 0)) ?? [])),
    furnitureCategories: rows.furnitureCategories.map(mapFurnitureCategory),
    furnitureItems: rows.furnitureItems.map(mapFurnitureItem),
    cateringPackages: rows.cateringPackages.map(mapCateringPackage),
    galleryCategories,
    galleryItems: rows.galleryItems.map((row) =>
      mapGalleryItem(row, gallerySlugById.get(Number(row.category_id ?? 0)) ?? ''),
    ),
    videos: rows.videos.map(mapVideo),
  };
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function checkSlugs(collection: string, items: Array<{ slug: string }>, problems: string[]): void {
  for (const item of items) {
    const slug = (item.slug ?? '').trim();
    if (!slug) {
      problems.push(`${collection}: an item is missing a slug`);
    } else if (!SLUG_PATTERN.test(slug)) {
      problems.push(`${collection}: unsafe slug "${slug}"`);
    }
  }
  for (const dupe of duplicates(items.map((item) => item.slug))) {
    problems.push(`${collection}: duplicate slug "${dupe}"`);
  }
}

/**
 * Validates that a snapshot is complete and internally consistent. Used by the
 * build-time sync and by the publish-readiness check so the two can never drift.
 */
export function validateSnapshotData(snapshot: PublicContentSnapshot): void {
  const problems: string[] = [];

  const settings = snapshot.settings;
  if (!settings) {
    problems.push('site_settings: the global row is missing');
  } else {
    for (const field of ['name', 'phone', 'email', 'address'] as const) {
      if (!String(settings[field] ?? '').trim()) {
        problems.push(`site_settings: required field "${field}" is empty`);
      }
    }
  }

  const pageKeys = new Set(snapshot.pages.map((page) => page.page_key));
  for (const key of REQUIRED_PAGE_KEYS) {
    if (!pageKeys.has(key)) problems.push(`page_content: published page "${key}" is missing`);
  }

  if (snapshot.mandaps.length === 0) problems.push('mandaps: no visible mandaps');
  if (snapshot.stages.length === 0) problems.push('stages: no visible stages');
  if (snapshot.furnitureCategories.length === 0) problems.push('furniture_categories: no visible categories');
  if (snapshot.furnitureItems.length === 0) problems.push('furniture_items: no visible items');
  if (snapshot.galleryCategories.length === 0) problems.push('gallery_categories: no visible categories');
  if (snapshot.galleryItems.length === 0) problems.push('gallery_items: no visible items');

  checkSlugs('mandaps', snapshot.mandaps, problems);
  checkSlugs('stages', snapshot.stages, problems);
  checkSlugs('furniture_categories', snapshot.furnitureCategories, problems);
  checkSlugs('furniture_items', snapshot.furnitureItems, problems);
  checkSlugs('catering_packages', snapshot.cateringPackages, problems);
  checkSlugs('gallery_categories', snapshot.galleryCategories, problems);

  const furnitureCategoryIds = new Set(snapshot.furnitureCategories.map((c) => c.id));
  const galleryCategoryIds = new Set(snapshot.galleryCategories.map((c) => c.id));

  for (const item of snapshot.furnitureItems) {
    if (!furnitureCategoryIds.has(item.category_id)) {
      problems.push(`furniture_items: "${item.slug}" references a missing category (${item.category_id})`);
    }
  }
  for (const item of snapshot.galleryItems) {
    if (!galleryCategoryIds.has(item.category_id) || !item.category_slug) {
      problems.push(`gallery_items: item ${item.id} references a missing category (${item.category_id})`);
    }
  }
  for (const mandap of snapshot.mandaps) {
    for (const image of mandap.gallery) {
      if (!image.image_url) problems.push(`mandap_gallery: empty image_url for mandap ${mandap.slug}`);
    }
  }
  for (const stage of snapshot.stages) {
    for (const image of stage.gallery) {
      if (!image.image_url) problems.push(`stage_gallery: empty image_url for stage ${stage.slug}`);
    }
  }

  if (problems.length > 0) throw new SnapshotValidationError(problems);
}

export function snapshotCounts(snapshot: PublicContentSnapshot): SnapshotCounts {
  return {
    pages: snapshot.pages.length,
    seo: snapshot.seo.length,
    homeSections: snapshot.homeSections.length,
    services: snapshot.services.length,
    mandaps: snapshot.mandaps.length,
    stages: snapshot.stages.length,
    furnitureCategories: snapshot.furnitureCategories.length,
    furnitureItems: snapshot.furnitureItems.length,
    cateringPackages: snapshot.cateringPackages.length,
    galleryCategories: snapshot.galleryCategories.length,
    galleryItems: snapshot.galleryItems.length,
    videos: snapshot.videos.length,
  };
}

/** Deterministic JSON so the content version is stable across serializations. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export function computeContentVersion(snapshot: PublicContentSnapshot): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex').slice(0, 16);
}

export function buildManifest(
  snapshot: PublicContentSnapshot,
  generatedAt = new Date().toISOString(),
): SnapshotManifest {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contentVersion: computeContentVersion(snapshot),
    generatedAt,
    source: 'cloudflare-d1',
    counts: snapshotCounts(snapshot),
  };
}
