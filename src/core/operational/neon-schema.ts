export const neonSchemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(255) UNIQUE,
  password_hash TEXT NOT NULL,
  first_name    VARCHAR(100) NOT NULL DEFAULT '',
  role          VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'editor', 'admin', 'superadmin', 'developer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name       VARCHAR(255) NOT NULL,
  phone      VARCHAR(50) NOT NULL,
  email      VARCHAR(255),
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);

CREATE TABLE IF NOT EXISTS bookings (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  access_token    VARCHAR(100) NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_date      VARCHAR(50),
  event_time      VARCHAR(50),
  event_type      VARCHAR(100) NOT NULL DEFAULT 'Wedding',
  total_guest     INTEGER NOT NULL DEFAULT 100,
  special_request TEXT NOT NULL DEFAULT '',
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'confirmed', 'cancelled')),
  total_amount    BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS booking_items (
  id            SERIAL PRIMARY KEY,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  category      VARCHAR(50) NOT NULL,
  item_id       VARCHAR(100) NOT NULL DEFAULT '',
  item_name     VARCHAR(255) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  unit_price    BIGINT NOT NULL DEFAULT 0,
  subtotal      BIGINT NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON booking_items(booking_id);

CREATE TABLE IF NOT EXISTS event_enquiries (
  id                   SERIAL PRIMARY KEY,
  reference_code       VARCHAR(50) NOT NULL UNIQUE,
  customer_name        VARCHAR(255) NOT NULL,
  customer_phone       VARCHAR(50) NOT NULL,
  customer_email       VARCHAR(255),
  event_type           VARCHAR(100) NOT NULL,
  event_date           VARCHAR(50) NOT NULL,
  end_date             VARCHAR(50),
  event_time           VARCHAR(50),
  venue_location       TEXT NOT NULL,
  guest_count          INTEGER NOT NULL DEFAULT 100,
  budget_range         VARCHAR(100) NOT NULL DEFAULT '',
  requires_rooms       BOOLEAN NOT NULL DEFAULT false,
  room_count           INTEGER NOT NULL DEFAULT 0,
  accommodation_notes  TEXT NOT NULL DEFAULT '',
  decoration_notes     TEXT NOT NULL DEFAULT '',
  preferred_contact    VARCHAR(50) NOT NULL DEFAULT 'Phone',
  status               VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'quoted', 'confirmed', 'archived')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_enquiries_status ON event_enquiries(status);
CREATE INDEX IF NOT EXISTS idx_event_enquiries_date ON event_enquiries(event_date);
CREATE INDEX IF NOT EXISTS idx_event_enquiries_ref ON event_enquiries(reference_code);

CREATE TABLE IF NOT EXISTS enquiry_line_items (
  id                           SERIAL PRIMARY KEY,
  enquiry_id                   INTEGER NOT NULL REFERENCES event_enquiries(id) ON DELETE CASCADE,
  item_type                    VARCHAR(100) NOT NULL,
  catalogue_item_id            INTEGER,
  item_name_snapshot           VARCHAR(255) NOT NULL,
  quantity                     INTEGER NOT NULL DEFAULT 1,
  standard_dimensions_snapshot VARCHAR(100) NOT NULL DEFAULT '',
  requested_length_ft          NUMERIC(8,2),
  requested_width_ft           NUMERIC(8,2),
  requested_height_ft          NUMERIC(8,2),
  specifications               TEXT NOT NULL DEFAULT '',
  notes                        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_enquiry_line_items_enquiry ON enquiry_line_items(enquiry_id);

CREATE TABLE IF NOT EXISTS contact_inquiries (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  phone       VARCHAR(50) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  event_type  VARCHAR(100) NOT NULL DEFAULT '',
  event_date  VARCHAR(50),
  guest_count INTEGER,
  message     TEXT NOT NULL DEFAULT '',
  status      VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_inquiries_status ON contact_inquiries(status);

CREATE TABLE IF NOT EXISTS traffic_events (
  id               SERIAL PRIMARY KEY,
  session_id       VARCHAR(100) NOT NULL,
  path             VARCHAR(255) NOT NULL,
  referrer         VARCHAR(255) NOT NULL DEFAULT 'direct',
  device_type      VARCHAR(50) NOT NULL DEFAULT 'desktop',
  browser          VARCHAR(100) NOT NULL DEFAULT 'Other',
  os               VARCHAR(100) NOT NULL DEFAULT 'Other',
  city             VARCHAR(100) NOT NULL DEFAULT 'Ranchi',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  utm_source       VARCHAR(100) NOT NULL DEFAULT '',
  utm_medium       VARCHAR(100) NOT NULL DEFAULT '',
  utm_campaign     VARCHAR(100) NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_events_created ON traffic_events(created_at);
CREATE INDEX IF NOT EXISTS idx_traffic_events_path ON traffic_events(path);
CREATE INDEX IF NOT EXISTS idx_traffic_events_session ON traffic_events(session_id);

-- Filebase Storage Ledger
CREATE TABLE IF NOT EXISTS storage_objects (
  id                  SERIAL PRIMARY KEY,
  object_id           VARCHAR(100) NOT NULL UNIQUE,
  storage_category    VARCHAR(20) NOT NULL CHECK (storage_category IN ('gallery', 'asset')),
  entity_type         VARCHAR(50) NOT NULL,
  entity_id           VARCHAR(100) NOT NULL DEFAULT '',
  slot                VARCHAR(50) NOT NULL DEFAULT 'primary',
  object_key          VARCHAR(255) NOT NULL UNIQUE,
  public_url          TEXT NOT NULL,
  mime_type           VARCHAR(100) NOT NULL,
  size_bytes          BIGINT NOT NULL,
  width               INTEGER,
  height              INTEGER,
  format              VARCHAR(20) NOT NULL,
  original_filename   VARCHAR(255) NOT NULL DEFAULT '',
  status              VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_replacement', 'pending_deletion', 'deleted')),
  deletion_attempts   INTEGER NOT NULL DEFAULT 0,
  last_deletion_error TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_cat_status ON storage_objects(storage_category, status);
CREATE INDEX IF NOT EXISTS idx_storage_objects_entity ON storage_objects(entity_type, entity_id, slot);
CREATE INDEX IF NOT EXISTS idx_storage_objects_key ON storage_objects(object_key);
CREATE INDEX IF NOT EXISTS idx_storage_objects_status ON storage_objects(status);

CREATE TABLE IF NOT EXISTS storage_reservations (
  id               VARCHAR(100) PRIMARY KEY,
  storage_category VARCHAR(20) NOT NULL CHECK (storage_category IN ('gallery', 'asset')),
  reserved_bytes   BIGINT NOT NULL,
  entity_type      VARCHAR(50) NOT NULL,
  entity_id        VARCHAR(100) NOT NULL DEFAULT '',
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_reservations_cat ON storage_reservations(storage_category, expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id   VARCHAR(100) NOT NULL DEFAULT '',
  details     TEXT NOT NULL DEFAULT '{}',
  ip_address  VARCHAR(50) NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
`;
