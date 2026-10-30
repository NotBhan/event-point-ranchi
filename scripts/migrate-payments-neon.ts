import { getNeonClient } from '../src/core/operational/neon-client';

async function migrate() {
  console.log('[Migration] Starting Neon operational database payment migration...');
  const neon = getNeonClient();

  // 1. Add financial columns to bookings table
  console.log('[Migration] Step 1: Updating bookings table with payment columns...');
  await neon.query(`
    ALTER TABLE bookings 
    ADD COLUMN IF NOT EXISTS advance_amount BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS amount_paid BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS outstanding_balance BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'unpaid';
  `);

  // Update existing bookings so outstanding_balance equals total_amount, advance is 25%
  await neon.query(`
    UPDATE bookings 
    SET 
      advance_amount = CASE WHEN total_amount > 0 THEN (total_amount * 25) / 100 ELSE 0 END,
      outstanding_balance = CASE WHEN outstanding_balance = 0 AND total_amount > 0 THEN total_amount - amount_paid ELSE outstanding_balance END
    WHERE advance_amount = 0 AND total_amount > 0;
  `);

  // 2. Create payments table
  console.log('[Migration] Step 2: Creating payments table...');
  await neon.query(`
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
  `);

  // 3. Create payment_webhook_events table
  console.log('[Migration] Step 3: Creating payment_webhook_events table...');
  await neon.query(`
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
  `);

  // 4. Create refunds table
  console.log('[Migration] Step 4: Creating refunds table...');
  await neon.query(`
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
  `);

  // 5. Create payment_reconciliation table
  console.log('[Migration] Step 5: Creating payment_reconciliation table...');
  await neon.query(`
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
  `);

  // 6. Create invoices table
  console.log('[Migration] Step 6: Creating invoices table...');
  await neon.query(`
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
  `);

  console.log('[Migration] Successfully executed Neon payment migration!');
}

migrate().catch((err) => {
  console.error('[Migration] Failed:', err);
  process.exit(1);
});
