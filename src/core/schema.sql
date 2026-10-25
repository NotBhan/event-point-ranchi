PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'superadmin', 'developer')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT,
  address    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);

CREATE TABLE IF NOT EXISTS halls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  image            TEXT,
  banner_image     TEXT,
  price_paise      INTEGER NOT NULL DEFAULT 0,
  capacity         INTEGER NOT NULL DEFAULT 0,
  location         TEXT NOT NULL DEFAULT '',
  parking_capacity INTEGER NOT NULL DEFAULT 0,
  is_ac            INTEGER NOT NULL DEFAULT 1,
  is_wifi          INTEGER NOT NULL DEFAULT 1,
  is_featured      INTEGER NOT NULL DEFAULT 0,
  show_badge       INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_halls_active ON halls(is_active);

CREATE TABLE IF NOT EXISTS hall_features (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id  INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  icon     TEXT NOT NULL DEFAULT 'check',
  title    TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hall_features_hall ON hall_features(hall_id);

CREATE TABLE IF NOT EXISTS hall_gallery (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  image   TEXT NOT NULL,
  title   TEXT NOT NULL DEFAULT '',
  sort    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hall_gallery_hall ON hall_gallery(hall_id);

CREATE TABLE IF NOT EXISTS furniture_categories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_furniture_categories_hall ON furniture_categories(hall_id);

CREATE TABLE IF NOT EXISTS furniture_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id      INTEGER NOT NULL REFERENCES furniture_categories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  icon             TEXT NOT NULL DEFAULT 'chair',
  price_paise      INTEGER NOT NULL DEFAULT 0,
  unit             TEXT NOT NULL DEFAULT 'piece',
  default_quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity     INTEGER NOT NULL DEFAULT 0,
  max_quantity     INTEGER NOT NULL DEFAULT 100,
  is_required      INTEGER NOT NULL DEFAULT 0,
  sort             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_furniture_items_category ON furniture_items(category_id);

CREATE TABLE IF NOT EXISTS stage_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id     INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stage_categories_hall ON stage_categories(hall_id);

CREATE TABLE IF NOT EXISTS stage_designs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES stage_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  badge       TEXT NOT NULL DEFAULT 'New!',
  image       TEXT,
  price_paise INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stage_designs_category ON stage_designs(category_id);

CREATE TABLE IF NOT EXISTS service_categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id  INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_service_categories_hall ON service_categories(hall_id);

CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);

CREATE TABLE IF NOT EXISTS rooms (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  price_paise    INTEGER NOT NULL DEFAULT 0,
  capacity       INTEGER NOT NULL DEFAULT 1,
  total_rooms    INTEGER NOT NULL DEFAULT 1,
  image          TEXT,
  description    TEXT NOT NULL DEFAULT '',
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_features (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_features_room ON room_features(room_id);

CREATE TABLE IF NOT EXISTS catering_packages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  image        TEXT,
  price_paise  INTEGER NOT NULL DEFAULT 0,
  description  TEXT NOT NULL DEFAULT '',
  badge        TEXT NOT NULL DEFAULT '',
  show_on_home INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS catering_features (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL REFERENCES catering_packages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS banner_features (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL REFERENCES catering_packages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_sections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id      INTEGER NOT NULL REFERENCES catering_packages(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  has_category    INTEGER NOT NULL DEFAULT 1,
  available_items INTEGER NOT NULL DEFAULT 0,
  max_selection   INTEGER NOT NULL DEFAULT 0,
  sort            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_menu_sections_package ON menu_sections(package_id);

CREATE TABLE IF NOT EXISTS menu_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_menu_categories_section ON menu_categories(section_id);

CREATE TABLE IF NOT EXISTS menu_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);

CREATE TABLE IF NOT EXISTS guest_pricing (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id     INTEGER NOT NULL REFERENCES catering_packages(id) ON DELETE CASCADE,
  guest_count    INTEGER NOT NULL,
  price_per_plate_paise INTEGER NOT NULL DEFAULT 0,
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_guest_pricing_package ON guest_pricing(package_id);

CREATE TABLE IF NOT EXISTS bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  access_token    TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  event_date      TEXT,
  event_time      TEXT,
  event_type      TEXT NOT NULL DEFAULT 'Wedding',
  total_guest     INTEGER NOT NULL DEFAULT 100,
  special_request TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'confirmed', 'cancelled')),
  total_amount    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS booking_halls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  hall_id    INTEGER NOT NULL REFERENCES halls(id),
  price      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_id    INTEGER NOT NULL REFERENCES rooms(id),
  quantity   INTEGER NOT NULL DEFAULT 1,
  price      INTEGER NOT NULL DEFAULT 0,
  subtotal   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_furniture (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  furniture_id INTEGER NOT NULL REFERENCES furniture_items(id),
  quantity     INTEGER NOT NULL DEFAULT 0,
  price        INTEGER NOT NULL DEFAULT 0,
  subtotal     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_stages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  stage_id   INTEGER NOT NULL REFERENCES stage_designs(id),
  price      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_services (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  price      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_catering (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id         INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  package_id         INTEGER NOT NULL REFERENCES catering_packages(id),
  guest_count        INTEGER NOT NULL DEFAULT 0,
  price_per_plate    INTEGER NOT NULL DEFAULT 0,
  total_price        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_menu_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_catering_id INTEGER NOT NULL REFERENCES booking_catering(id) ON DELETE CASCADE,
  section             TEXT NOT NULL DEFAULT '',
  item_name           TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS gallery_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  sort      INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gallery_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES gallery_categories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_gallery_items_category ON gallery_items(category_id);

CREATE TABLE IF NOT EXISTS contact_inquiries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  event_type  TEXT NOT NULL DEFAULT '',
  event_date  TEXT,
  guest_count INTEGER,
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homepage (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  hero_title       TEXT NOT NULL,
  hero_description TEXT NOT NULL,
  hero_image       TEXT
);

CREATE TABLE IF NOT EXISTS homepage_features (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  icon        TEXT NOT NULL DEFAULT 'sparkles',
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_info (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  address TEXT NOT NULL,
  phone   TEXT NOT NULL,
  email   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS page_settings (
  key           TEXT PRIMARY KEY,
  hero_title    TEXT NOT NULL DEFAULT '',
  hero_subtitle TEXT NOT NULL DEFAULT '',
  hero_badge    TEXT NOT NULL DEFAULT '',
  hero_image    TEXT
);

CREATE TABLE IF NOT EXISTS mandaps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  image           TEXT,
  category        TEXT NOT NULL DEFAULT 'Traditional Royal',
  length_ft       REAL NOT NULL DEFAULT 16,
  width_ft        REAL NOT NULL DEFAULT 16,
  height_ft       REAL NOT NULL DEFAULT 12,
  dimension_unit  TEXT NOT NULL DEFAULT 'ft',
  material_specs  TEXT NOT NULL DEFAULT '',
  sort            INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mandaps_active ON mandaps(is_active);
CREATE INDEX IF NOT EXISTS idx_mandaps_category ON mandaps(category);

CREATE TABLE IF NOT EXISTS mandap_gallery (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  mandap_id INTEGER NOT NULL REFERENCES mandaps(id) ON DELETE CASCADE,
  image     TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mandap_gallery_mandap ON mandap_gallery(mandap_id);

CREATE TABLE IF NOT EXISTS stages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  description        TEXT NOT NULL DEFAULT '',
  image              TEXT,
  style_category     TEXT NOT NULL DEFAULT 'Royal Reception',
  length_ft          REAL NOT NULL DEFAULT 24,
  width_ft           REAL NOT NULL DEFAULT 16,
  height_ft          REAL NOT NULL DEFAULT 14,
  dimension_unit     TEXT NOT NULL DEFAULT 'ft',
  decoration_notes   TEXT NOT NULL DEFAULT '',
  sort               INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stages_active ON stages(is_active);
CREATE INDEX IF NOT EXISTS idx_stages_category ON stages(style_category);

CREATE TABLE IF NOT EXISTS stage_gallery (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  image    TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stage_gallery_stage ON stage_gallery(stage_id);

CREATE TABLE IF NOT EXISTS equipment_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  icon      TEXT NOT NULL DEFAULT 'chair',
  sort      INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS equipment_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id      INTEGER NOT NULL REFERENCES equipment_categories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  image            TEXT,
  unit             TEXT NOT NULL DEFAULT 'piece',
  specifications   TEXT NOT NULL DEFAULT '',
  min_quantity     INTEGER NOT NULL DEFAULT 1,
  default_quantity INTEGER NOT NULL DEFAULT 10,
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_equipment_items_category ON equipment_items(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_items_active ON equipment_items(is_active);

CREATE TABLE IF NOT EXISTS event_enquiries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_code       TEXT NOT NULL UNIQUE,
  customer_name        TEXT NOT NULL,
  customer_phone       TEXT NOT NULL,
  customer_email       TEXT,
  event_type           TEXT NOT NULL,
  event_date           TEXT NOT NULL,
  end_date             TEXT,
  event_time           TEXT,
  venue_location       TEXT NOT NULL,
  guest_count          INTEGER NOT NULL DEFAULT 100,
  budget_range         TEXT NOT NULL DEFAULT '',
  requires_rooms       INTEGER NOT NULL DEFAULT 0,
  room_count           INTEGER NOT NULL DEFAULT 0,
  accommodation_notes  TEXT NOT NULL DEFAULT '',
  decoration_notes     TEXT NOT NULL DEFAULT '',
  preferred_contact    TEXT NOT NULL DEFAULT 'Phone',
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'quoted', 'confirmed', 'archived')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_enquiries_status ON event_enquiries(status);
CREATE INDEX IF NOT EXISTS idx_event_enquiries_date ON event_enquiries(event_date);
CREATE INDEX IF NOT EXISTS idx_event_enquiries_reference ON event_enquiries(reference_code);

CREATE TABLE IF NOT EXISTS enquiry_line_items (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id                  INTEGER NOT NULL REFERENCES event_enquiries(id) ON DELETE CASCADE,
  item_type                   TEXT NOT NULL,
  catalogue_item_id           INTEGER,
  item_name_snapshot          TEXT NOT NULL,
  quantity                    INTEGER NOT NULL DEFAULT 1,
  standard_dimensions_snapshot TEXT NOT NULL DEFAULT '',
  requested_length_ft         REAL,
  requested_width_ft          REAL,
  requested_height_ft         REAL,
  specifications              TEXT NOT NULL DEFAULT '',
  notes                       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_enquiry_line_items_enquiry ON enquiry_line_items(enquiry_id);

