export interface PageContent {
  id: number;
  page_key: string;
  title: string;
  subtitle: string;
  description: string;
  banner_image_url: string;
  banner_enabled: boolean;
  content_json: Record<string, any>;
  seo_title: string;
  seo_description: string;
  og_image_url: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface SiteSettings {
  id: string;
  name: string;
  legal_name: string;
  tagline: string;
  short_description: string;
  logo_url: string;
  favicon_url: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  venue_address: string;
  business_hours: string;
  social_links_json: string;
  primary_color: string;
  gold_bright: string;
  font_preset: string;
  default_title: string;
  default_description: string;
  og_image_url: string;
  currency: string;
  locale: string;
  announcement_enabled: number;
  announcement_text: string;
  announcement_location: string;
  announcement_phone: string;
  google_maps_url: string;
  latitude: number | null;
  longitude: number | null;
  footer_text: string;
  contact_buttons_enabled: number;
  maintenance_enabled: number;
  maintenance_message: string;
  created_at: string;
  updated_at: string;
}

export interface MergedSiteSettings {
  name: string;
  legalName: string;
  tagline: string;
  shortDescription: string;
  logo: string;
  favicon: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  venueAddress: string;
  businessHours: string;
  announcementText?: string;
  googleMapsUrl: string;
  latitude: number | null;
  longitude: number | null;
  footerText: string;
  contactButtonsEnabled: boolean;
  social: Array<{ label: string; href: string }>;
  theme: {
    primaryColor: string;
    goldBright: string;
    fontPreset: string;
  };
  seo: {
    defaultTitle: string;
    defaultDescription: string;
    ogImage: string;
  };
}

export interface HomepageSection {
  id: string;
  section_key: string;
  section_type: string;
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  cta_label: string;
  cta_url: string;
  badge: string;
  is_visible: number;
  sort_order: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface MergedHomepageContent {
  heroHeading: string;
  heroSubtitle: string;
  heroImage: string;
  primaryCta: { label: string; url: string };
  secondaryCta: { label: string; url: string };
  announcementBar: {
    enabled: boolean;
    text: string;
    location: string;
    phone: string;
  };
  features: Array<{ icon: string; title: string; description: string }>;
  steps: Array<{ stepNumber: string; title: string; description: string }>;
  sectionsVisibility: {
    mandaps: boolean;
    stages: boolean;
    equipment: boolean;
    catering: boolean;
    gallery: boolean;
    stats: boolean;
  };
  promotionalBanner?: {
    enabled: boolean;
    badge: string;
    headline: string;
    description: string;
    ctaLabel: string;
    ctaUrl: string;
  };
}

export interface ServiceItem {
  id: number;
  slug: string;
  title: string;
  description: string;
  badge: string;
  image_url: string;
  features: string[];
  is_visible: boolean;
  sort_order: number;
}

export interface MandapItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  material_specs: string;
  price_starting_paise: number;
  capacity: number;
  features: string[];
  image_url: string;
  location_name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string;
  directions_url: string;
  show_location: boolean;
  gallery: Array<{ id: number; image_url: string; caption: string; sort_order: number }>;
  is_featured: boolean;
  is_visible: boolean;
  sort_order: number;
}

export interface StageItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  style_category: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  decoration_notes: string;
  price_starting_paise: number;
  image_url: string;
  gallery: Array<{ id: number; image_url: string; caption: string; sort_order: number }>;
  is_featured: boolean;
  is_visible: boolean;
  sort_order: number;
}

export interface FurnitureCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sort_order: number;
  is_visible: boolean;
}

export interface FurnitureItem {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  price_paise: number;
  pricing_unit: string;
  dimensions: string;
  specifications: string;
  min_quantity: number;
  default_quantity: number;
  is_visible: boolean;
  sort_order: number;
}

export interface CateringPackage {
  id: number;
  name: string;
  slug: string;
  description: string;
  badge: string;
  image_url: string;
  price_per_plate_paise: number;
  features: string[];
  menu_sections: any[];
  guest_pricing: any[];
  show_on_home: boolean;
  is_visible: boolean;
  sort_order: number;
}

export interface RoomOption {
  id: number;
  name: string;
  description: string;
  price_paise: number;
  capacity: number;
  total_rooms: number;
  image_url: string;
  features: string[];
  is_visible: boolean;
  sort_order: number;
}

export interface GalleryCategory {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_visible: boolean;
}

export interface GalleryItem {
  id: number;
  category_id: number;
  caption: string;
  image_url: string;
  alt_text: string;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
}

export interface SeoSettings {
  id: number;
  page_key: string;
  title: string;
  description: string;
  canonical_url: string;
  og_image_url: string;
}

export type VideoPlatform = 'youtube' | 'youtube_shorts' | 'instagram_reels';

export interface VideoPreviewItem {
  id: number;
  title: string;
  description: string;
  platform: VideoPlatform;
  video_url: string;
  video_id: string;
  thumbnail_url: string;
  aspect_ratio: '16:9' | '9:16';
  is_featured: boolean;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ParsedVideoUrl {
  valid: boolean;
  platform: VideoPlatform;
  videoId: string;
  aspectRatio: '16:9' | '9:16';
  embedUrl: string;
  defaultThumbnailUrl: string;
  externalWatchUrl: string;
  error?: string;
}
