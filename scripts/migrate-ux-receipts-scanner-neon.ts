import { getNeonClient } from '../src/core/operational/neon-client';

async function migrate() {
  console.log('[Migration] Starting Neon database migration for payment_receipts and enquiry_qr_tokens...');
  const neon = getNeonClient();

  // 1. Create payment_receipts table
  console.log('[Migration] Step 1: Creating payment_receipts table...');
  await neon.query(`
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
  `);

  // 2. Create enquiry_qr_tokens table
  console.log('[Migration] Step 2: Creating enquiry_qr_tokens table...');
  await neon.query(`
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
  `);

  console.log('[Migration] Successfully executed Neon payment_receipts & enquiry_qr_tokens migration!');
}

migrate().catch((err) => {
  console.error('[Migration] Failed:', err);
  process.exit(1);
});
