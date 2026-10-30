-- Cloudflare D1 Website Content Schema
-- Source of truth for mutable website content: site settings, homepage sections,
-- services, mandaps, stages, furniture/equipment, catering packages, gallery items, and SEO.

CREATE TABLE IF NOT EXISTS site_settings (
  id                    TEXT PRIMARY KEY DEFAULT 'global',
  name                  TEXT NOT NULL,
  legal_name            TEXT NOT NULL,
  tagline               TEXT NOT NULL,
  short_description     TEXT NOT NULL,
  logo_url              TEXT NOT NULL,
  favicon_url           TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  whatsapp              TEXT NOT NULL,
  email                 TEXT NOT NULL,
  address               TEXT NOT NULL,
  venue_address         TEXT NOT NULL,
  business_hours        TEXT NOT NULL,
  social_links_json     TEXT NOT NULL DEFAULT '[]',
  primary_color         TEXT NOT NULL DEFAULT '#721224',
  gold_bright           TEXT NOT NULL DEFAULT '#e0b868',
  font_preset           TEXT NOT NULL DEFAULT 'heritage',
  default_title         TEXT NOT NULL,
  default_description   TEXT NOT NULL,
  og_image_url          TEXT NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'INR',
  locale                TEXT NOT NULL DEFAULT 'en-IN',
  announcement_enabled  INTEGER NOT NULL DEFAULT 1,
  announcement_text     TEXT NOT NULL DEFAULT '',
  announcement_location TEXT NOT NULL DEFAULT '',
  announcement_phone    TEXT NOT NULL DEFAULT '',
  maintenance_enabled   INTEGER NOT NULL DEFAULT 0,
  maintenance_message   TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homepage_sections (
  id           TEXT PRIMARY KEY,
  section_key  TEXT NOT NULL UNIQUE,
  section_type TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  subtitle     TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  image_url    TEXT NOT NULL DEFAULT '',
  cta_label    TEXT NOT NULL DEFAULT '',
  cta_url      TEXT NOT NULL DEFAULT '',
  badge        TEXT NOT NULL DEFAULT '',
  is_visible   INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  config_json  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_homepage_sections_key ON homepage_sections(section_key);
CREATE INDEX IF NOT EXISTS idx_homepage_sections_sort ON homepage_sections(sort_order);

CREATE TABLE IF NOT EXISTS services (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  badge         TEXT NOT NULL DEFAULT '',
  image_url     TEXT NOT NULL DEFAULT '',
  features_json TEXT NOT NULL DEFAULT '[]',
  is_visible    INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_slug ON services(slug);
CREATE INDEX IF NOT EXISTS idx_services_sort ON services(sort_order);

CREATE TABLE IF NOT EXISTS mandaps (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  description          TEXT NOT NULL DEFAULT '',
  category             TEXT NOT NULL DEFAULT 'Traditional Royal',
  length_ft            REAL NOT NULL DEFAULT 16,
  width_ft             REAL NOT NULL DEFAULT 16,
  height_ft            REAL NOT NULL DEFAULT 12,
  dimension_unit       TEXT NOT NULL DEFAULT 'ft',
  material_specs       TEXT NOT NULL DEFAULT '',
  price_starting_paise INTEGER NOT NULL DEFAULT 0,
  capacity             INTEGER NOT NULL DEFAULT 0,
  features_json        TEXT NOT NULL DEFAULT '[]',
  image_url            TEXT NOT NULL DEFAULT '',
  is_featured          INTEGER NOT NULL DEFAULT 0,
  is_visible           INTEGER NOT NULL DEFAULT 1,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mandaps_slug ON mandaps(slug);
CREATE INDEX IF NOT EXISTS idx_mandaps_visible ON mandaps(is_visible);
CREATE INDEX IF NOT EXISTS idx_mandaps_category ON mandaps(category);
CREATE INDEX IF NOT EXISTS idx_mandaps_sort ON mandaps(sort_order);

CREATE TABLE IF NOT EXISTS mandap_gallery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mandap_id  INTEGER NOT NULL REFERENCES mandaps(id) ON DELETE CASCADE,
  image_url  TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mandap_gallery_mandap ON mandap_gallery(mandap_id);

CREATE TABLE IF NOT EXISTS stages (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  description          TEXT NOT NULL DEFAULT '',
  style_category       TEXT NOT NULL DEFAULT 'Royal Reception',
  length_ft            REAL NOT NULL DEFAULT 24,
  width_ft             REAL NOT NULL DEFAULT 16,
  height_ft            REAL NOT NULL DEFAULT 14,
  dimension_unit       TEXT NOT NULL DEFAULT 'ft',
  decoration_notes     TEXT NOT NULL DEFAULT '',
  price_starting_paise INTEGER NOT NULL DEFAULT 0,
  image_url            TEXT NOT NULL DEFAULT '',
  is_featured          INTEGER NOT NULL DEFAULT 0,
  is_visible           INTEGER NOT NULL DEFAULT 1,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stages_slug ON stages(slug);
CREATE INDEX IF NOT EXISTS idx_stages_visible ON stages(is_visible);
CREATE INDEX IF NOT EXISTS idx_stages_sort ON stages(sort_order);

CREATE TABLE IF NOT EXISTS stage_gallery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id   INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  image_url  TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stage_gallery_stage ON stage_gallery(stage_id);

CREATE TABLE IF NOT EXISTS furniture_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  icon       TEXT NOT NULL DEFAULT 'chair',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_furniture_cat_slug ON furniture_categories(slug);

CREATE TABLE IF NOT EXISTS furniture_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id      INTEGER NOT NULL REFERENCES furniture_categories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  image_url        TEXT NOT NULL DEFAULT '',
  price_paise      INTEGER NOT NULL DEFAULT 0,
  pricing_unit     TEXT NOT NULL DEFAULT 'per item',
  dimensions       TEXT NOT NULL DEFAULT '',
  specifications   TEXT NOT NULL DEFAULT '',
  min_quantity     INTEGER NOT NULL DEFAULT 1,
  default_quantity INTEGER NOT NULL DEFAULT 10,
  is_visible       INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_furniture_items_category ON furniture_items(category_id);
CREATE INDEX IF NOT EXISTS idx_furniture_items_slug ON furniture_items(slug);
CREATE INDEX IF NOT EXISTS idx_furniture_items_visible ON furniture_items(is_visible);

CREATE TABLE IF NOT EXISTS catering_packages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  description           TEXT NOT NULL DEFAULT '',
  badge                 TEXT NOT NULL DEFAULT '',
  image_url             TEXT NOT NULL DEFAULT '',
  price_per_plate_paise INTEGER NOT NULL DEFAULT 0,
  features_json         TEXT NOT NULL DEFAULT '[]',
  menu_sections_json    TEXT NOT NULL DEFAULT '[]',
  guest_pricing_json    TEXT NOT NULL DEFAULT '[]',
  show_on_home          INTEGER NOT NULL DEFAULT 0,
  is_visible            INTEGER NOT NULL DEFAULT 1,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catering_packages_slug ON catering_packages(slug);
CREATE INDEX IF NOT EXISTS idx_catering_packages_visible ON catering_packages(is_visible);

CREATE TABLE IF NOT EXISTS gallery_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_gallery_categories_slug ON gallery_categories(slug);

CREATE TABLE IF NOT EXISTS gallery_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES gallery_categories(id) ON DELETE CASCADE,
  caption     TEXT NOT NULL DEFAULT '',
  image_url   TEXT NOT NULL,
  alt_text    TEXT NOT NULL DEFAULT '',
  is_visible  INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gallery_items_cat ON gallery_items(category_id);
CREATE INDEX IF NOT EXISTS idx_gallery_items_visible ON gallery_items(is_visible);

CREATE TABLE IF NOT EXISTS seo_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  page_key      TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  og_image_url  TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seo_settings_page ON seo_settings(page_key);

CREATE TABLE IF NOT EXISTS video_previews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  platform      TEXT NOT NULL, -- 'youtube' | 'youtube_shorts' | 'instagram_reels'
  video_url     TEXT NOT NULL,
  video_id      TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  aspect_ratio  TEXT NOT NULL DEFAULT '16:9', -- '16:9' | '9:16'
  is_featured   INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_video_previews_platform ON video_previews(platform);
CREATE INDEX IF NOT EXISTS idx_video_previews_published ON video_previews(is_published);
CREATE INDEX IF NOT EXISTS idx_video_previews_sort ON video_previews(sort_order);

