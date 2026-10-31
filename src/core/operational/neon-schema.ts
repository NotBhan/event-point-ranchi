export type {
  PaymentRow,
  PaymentMetrics,
  PaymentWebhookEventRow,
  RefundRow,
  PaymentReconciliationRow,
  InvoiceRow,
  BookingFinancialsRow,
  CustomerRow,
} from './service';

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
  id                  SERIAL PRIMARY KEY,
  customer_id         INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  access_token        VARCHAR(100) NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_date          VARCHAR(50),
  event_time          VARCHAR(50),
  event_type          VARCHAR(100) NOT NULL DEFAULT 'Wedding',
  total_guest         INTEGER NOT NULL DEFAULT 100,
  special_request     TEXT NOT NULL DEFAULT '',
  status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'confirmed', 'cancelled')),
  total_amount        BIGINT NOT NULL DEFAULT 0,
  advance_amount      BIGINT NOT NULL DEFAULT 0,
  amount_paid         BIGINT NOT NULL DEFAULT 0,
  outstanding_balance BIGINT NOT NULL DEFAULT 0,
  payment_status      VARCHAR(30) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'refunded'))
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

-- Payment Management & Compliance Tables (Neon PostgreSQL)
CREATE TABLE IF NOT EXISTS payments (
  id                             SERIAL PRIMARY KEY,
  booking_id                     INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id                    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  provider                       VARCHAR(50) NOT NULL,
  provider_order_id              VARCHAR(255),
  provider_payment_id            VARCHAR(255),
  internal_transaction_reference VARCHAR(100) NOT NULL UNIQUE,
  payment_type                   VARCHAR(50) NOT NULL DEFAULT 'advance',
  amount_paise                   BIGINT NOT NULL,
  currency                       VARCHAR(10) NOT NULL DEFAULT 'INR',
  status                         VARCHAR(50) NOT NULL DEFAULT 'created',
  payment_method                 VARCHAR(50),
  failure_code                   VARCHAR(100),
  failure_description            TEXT,
  metadata_json                  TEXT NOT NULL DEFAULT '{}',
  verified_at                    TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider);
CREATE INDEX IF NOT EXISTS idx_payments_provider_order ON payments(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_internal_ref ON payments(internal_transaction_reference);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                SERIAL PRIMARY KEY,
  provider          VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(255),
  event_type        VARCHAR(100) NOT NULL,
  payload_hash      VARCHAR(128) NOT NULL,
  processing_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_message     TEXT,
  raw_payload       TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_provider_event ON payment_webhook_events(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_payload_hash ON payment_webhook_events(payload_hash);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON payment_webhook_events(processing_status);

CREATE TABLE IF NOT EXISTS refunds (
  id                 SERIAL PRIMARY KEY,
  payment_id         INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  booking_id         INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_refund_id VARCHAR(255),
  amount_paise       BIGINT NOT NULL,
  reason             TEXT NOT NULL,
  status             VARCHAR(50) NOT NULL DEFAULT 'pending',
  failure_reason     TEXT,
  initiated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_booking ON refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_provider_refund ON refunds(provider_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

CREATE TABLE IF NOT EXISTS payment_reconciliation (
  id                      SERIAL PRIMARY KEY,
  provider                VARCHAR(50) NOT NULL,
  provider_transaction_id VARCHAR(255) NOT NULL,
  internal_payment_id     INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  provider_amount_paise   BIGINT NOT NULL,
  internal_amount_paise   BIGINT NOT NULL,
  reconciliation_status   VARCHAR(50) NOT NULL DEFAULT 'pending',
  notes                   TEXT,
  reconciled_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_provider_tx ON payment_reconciliation(provider, provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON payment_reconciliation(reconciliation_status);

CREATE TABLE IF NOT EXISTS invoices (
  id                   SERIAL PRIMARY KEY,
  booking_id           INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id           INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  invoice_number       VARCHAR(100) NOT NULL UNIQUE,
  invoice_type         VARCHAR(50) NOT NULL DEFAULT 'receipt',
  taxable_amount_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise           BIGINT NOT NULL DEFAULT 0,
  sgst_paise           BIGINT NOT NULL DEFAULT 0,
  igst_paise           BIGINT NOT NULL DEFAULT 0,
  total_amount_paise   BIGINT NOT NULL,
  customer_name        VARCHAR(255) NOT NULL,
  customer_phone       VARCHAR(50) NOT NULL,
  customer_email       VARCHAR(255),
  customer_address     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(payment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- Payment Receipts & QR Verification (Neon PostgreSQL)
CREATE TABLE IF NOT EXISTS payment_receipts (
  id                      SERIAL PRIMARY KEY,
  payment_id              INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  booking_id              INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  receipt_number          VARCHAR(100) NOT NULL UNIQUE,
  verification_token      VARCHAR(128) NOT NULL UNIQUE,
  verification_token_hash VARCHAR(128) NOT NULL UNIQUE,
  amount_paise            BIGINT NOT NULL,
  status                  VARCHAR(50) NOT NULL DEFAULT 'issued',
  pdf_storage_key         VARCHAR(255),
  issued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment ON payment_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_booking ON payment_receipts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_number ON payment_receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_token_hash ON payment_receipts(verification_token_hash);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status ON payment_receipts(status);

-- Customer Enquiry QR Tokens for Quick Admin Lookup
CREATE TABLE IF NOT EXISTS enquiry_qr_tokens (
  id                  SERIAL PRIMARY KEY,
  enquiry_id          INTEGER REFERENCES event_enquiries(id) ON DELETE CASCADE,
  contact_inquiry_id  INTEGER REFERENCES contact_inquiries(id) ON DELETE CASCADE,
  reference_code      VARCHAR(100) NOT NULL,
  token               VARCHAR(128) NOT NULL UNIQUE,
  token_hash          VARCHAR(128) NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_enquiry_qr_enquiry ON enquiry_qr_tokens(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_qr_contact ON enquiry_qr_tokens(contact_inquiry_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_qr_ref ON enquiry_qr_tokens(reference_code);
CREATE INDEX IF NOT EXISTS idx_enquiry_qr_token_hash ON enquiry_qr_tokens(token_hash);

-- Content publishing jobs (public content snapshot → Vercel deployment)
CREATE TABLE IF NOT EXISTS content_publications (
  id                TEXT PRIMARY KEY,
  requested_by      INTEGER,
  requested_by_name TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'requested',
  requested_version TEXT NOT NULL DEFAULT '',
  built_version     TEXT NOT NULL DEFAULT '',
  published_version TEXT NOT NULL DEFAULT '',
  deploy_hook_status INTEGER,
  deployment_id     TEXT NOT NULL DEFAULT '',
  deployment_url    TEXT NOT NULL DEFAULT '',
  error             TEXT NOT NULL DEFAULT '',
  requested_at      TEXT NOT NULL,
  built_at          TEXT,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_publications_status ON content_publications(status);
`;

