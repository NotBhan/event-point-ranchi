/**
 * Imports contact-form inquiries from the legacy SQLite database into Neon.
 *
 * Contact inquiries are operational records (the admin team follows them up), so
 * they must not live in the per-instance SQLite file that Vercel discards.
 *
 * Conservative by design:
 *   - dry run unless `--apply`;
 *   - read-only source;
 *   - deduplicates on (phone, email, created_at, message);
 *   - keeps the original id when it is free, otherwise imports under a new id;
 *   - never overwrites or deletes a Neon row.
 *
 * Usage:
 *   node --import tsx scripts/migrate-contact-inquiries-neon.ts
 *   node --import tsx scripts/migrate-contact-inquiries-neon.ts --apply
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getNeonClient } from '../src/core/operational/neon-client';

interface LegacyInquiry {
  id: number;
  name: string;
  phone: string;
  email: string;
  event_type: string;
  event_date: string | null;
  guest_count: number | null;
  message: string;
  status: string;
  created_at: string;
}

function parseArgs(argv: string[]): { apply: boolean; source: string } {
  const sourceIndex = argv.indexOf('--source');
  const dataDir = process.env.DATA_DIR || './data';
  return {
    apply: argv.includes('--apply'),
    source: sourceIndex >= 0 ? argv[sourceIndex + 1] : join(resolve(process.cwd(), dataDir), 'event-point.db'),
  };
}

function readLegacyInquiries(path: string): LegacyInquiry[] {
  if (!existsSync(path)) {
    throw new Error(`Legacy database not found at ${path}. Pass --source <path> or set DATA_DIR.`);
  }

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contact_inquiries'")
      .all();
    if (tables.length === 0) return [];
    return db
      .prepare(
        `SELECT id, name, phone, email, event_type, event_date, guest_count, message, status, created_at
           FROM contact_inquiries ORDER BY id`,
      )
      .all() as unknown as LegacyInquiry[];
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const legacy = readLegacyInquiries(options.source);
  const neon = getNeonClient();

  console.log(`Source  : ${options.source}`);
  console.log(`Target  : ${neon.isUsingRemote() ? 'Neon PostgreSQL' : 'local SQLite fallback'}`);
  console.log(`Mode    : ${options.apply ? 'apply' : 'dry run'}`);
  console.log(`Rows    : ${legacy.length}\n`);

  if (!options.apply) {
    console.log('No changes written. Re-run with --apply to import.');
    return;
  }

  if (!neon.isUsingRemote() && process.env.ALLOW_LOCAL_MIGRATION !== '1') {
    throw new Error(
      'Refusing to migrate into the local fallback database. Set DATABASE_URL to the target, ' +
        'or ALLOW_LOCAL_MIGRATION=1 for a rehearsal.',
    );
  }

  let imported = 0;
  let skipped = 0;

  for (const inquiry of legacy) {
    const duplicate = await neon.query<{ id: number }>(
      `SELECT id FROM contact_inquiries
        WHERE phone = $1 AND email = $2 AND CAST(created_at AS TEXT) = $3 AND message = $4
        LIMIT 1`,
      [inquiry.phone, inquiry.email, inquiry.created_at, inquiry.message],
    );

    if (duplicate.rows[0]) {
      skipped += 1;
      console.log(`skip   #${inquiry.id} — already present as #${duplicate.rows[0].id}`);
      continue;
    }

    const idTaken = await neon.query<{ id: number }>(
      'SELECT id FROM contact_inquiries WHERE id = $1 LIMIT 1',
      [inquiry.id],
    );

    const inserted = idTaken.rows[0]
      ? await neon.query<{ id: number }>(
          `INSERT INTO contact_inquiries
             (name, phone, email, event_type, event_date, guest_count, message, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            inquiry.name,
            inquiry.phone,
            inquiry.email,
            inquiry.event_type ?? '',
            inquiry.event_date,
            inquiry.guest_count,
            inquiry.message ?? '',
            inquiry.status ?? 'new',
            inquiry.created_at,
          ],
        )
      : await neon.query<{ id: number }>(
          `INSERT INTO contact_inquiries
             (id, name, phone, email, event_type, event_date, guest_count, message, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            inquiry.id,
            inquiry.name,
            inquiry.phone,
            inquiry.email,
            inquiry.event_type ?? '',
            inquiry.event_date,
            inquiry.guest_count,
            inquiry.message ?? '',
            inquiry.status ?? 'new',
            inquiry.created_at,
          ],
        );

    imported += 1;
    console.log(`import #${inquiry.id} -> #${inserted.rows[0]?.id}`);
  }

  console.log(`\nImported ${imported}, already present ${skipped}. Nothing was overwritten.`);
}

main().catch((error) => {
  console.error('\nMigration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
