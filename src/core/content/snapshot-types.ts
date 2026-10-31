import type {
  CateringPackage,
  FurnitureCategory,
  FurnitureItem,
  GalleryCategory,
  GalleryItem,
  HomepageSection,
  MandapItem,
  PageContent,
  SeoSettings,
  ServiceItem,
  SiteSettings,
  StageItem,
  VideoPreviewItem,
} from './types';
import type {
  CateringNameRow,
  GuestPricingRow,
  MenuCategoryRow,
  MenuItemRow,
  MenuSectionRow,
} from './catalog-store';

export const SNAPSHOT_SCHEMA_VERSION = 2;

export interface SnapshotGalleryItem extends GalleryItem {
  category_slug: string;
}

/**
 * Full catering menu structure. Mirrors the D1 tables so the public catering
 * pages can render without touching the database at request time.
 */
export interface SnapshotCateringMenu {
  features: CateringNameRow[];
  bannerFeatures: CateringNameRow[];
  guestPricing: GuestPricingRow[];
  sections: MenuSectionRow[];
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
}

/**
 * The complete set of public content served to visitors. It intentionally
 * contains only published/visible rows and only fields rendered publicly —
 * customer, enquiry, booking, payment and authentication records are never
 * part of this type or the builder that produces it.
 */
export interface PublicContentSnapshot {
  settings: SiteSettings | null;
  pages: PageContent[];
  seo: SeoSettings[];
  homeSections: HomepageSection[];
  services: ServiceItem[];
  mandaps: MandapItem[];
  stages: StageItem[];
  furnitureCategories: FurnitureCategory[];
  furnitureItems: FurnitureItem[];
  cateringPackages: CateringPackage[];
  cateringMenu: SnapshotCateringMenu;
  galleryCategories: GalleryCategory[];
  galleryItems: SnapshotGalleryItem[];
  videos: VideoPreviewItem[];
}

export interface SnapshotCounts {
  pages: number;
  seo: number;
  homeSections: number;
  services: number;
  mandaps: number;
  stages: number;
  furnitureCategories: number;
  furnitureItems: number;
  cateringPackages: number;
  cateringFeatures: number;
  menuSections: number;
  menuItems: number;
  galleryCategories: number;
  galleryItems: number;
  videos: number;
}

export interface SnapshotManifest {
  schemaVersion: number;
  contentVersion: string;
  generatedAt: string;
  source: 'cloudflare-d1';
  counts: SnapshotCounts;
}

export interface SnapshotBundle {
  snapshot: PublicContentSnapshot;
  manifest: SnapshotManifest;
}

export type ContentRow = Record<string, any>;

export interface PublicContentRows {
  settings: ContentRow | null;
  pages: ContentRow[];
  seo: ContentRow[];
  homeSections: ContentRow[];
  services: ContentRow[];
  mandaps: ContentRow[];
  mandapGallery: ContentRow[];
  stages: ContentRow[];
  stageGallery: ContentRow[];
  furnitureCategories: ContentRow[];
  furnitureItems: ContentRow[];
  cateringPackages: ContentRow[];
  cateringFeatures: ContentRow[];
  bannerFeatures: ContentRow[];
  guestPricing: ContentRow[];
  menuSections: ContentRow[];
  menuCategories: ContentRow[];
  menuItems: ContentRow[];
  galleryCategories: ContentRow[];
  galleryItems: ContentRow[];
  videos: ContentRow[];
}
