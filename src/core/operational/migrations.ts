/**
 * Versioned schema migrations for the operational database.
 *
 * Schema changes must not run during a user request: a normal request has no
 * business holding DDL privileges, and a failure halfway through would be
 * indistinguishable from a data error. Migrations live here, are applied by
 * `npm run db:migrate:schema`, and are recorded in `schema_migrations` so they
 * run exactly once.
 *
 * Each migration is written to be safe to re-run (it checks before it changes),
 * because a crash between the DDL and the bookkeeping insert would otherwise
 * leave the schema ahead of the record.
 */

export type MigrationDialect = 'postgres' | 'sqlite';

export interface MigrationClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  isUsingRemote?(): boolean;
}

export interface MigrationContext {
  client: MigrationClient;
  dialect: MigrationDialect;
  hasColumn(table: string, column: string): Promise<boolean>;
}

export interface SchemaMigration {
  id: string;
  description: string;
  up(context: MigrationContext): Promise<void>;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

async function hasColumn(
  client: MigrationClient,
  dialect: MigrationDialect,
  table: string,
  column: string,
): Promise<boolean> {
  if (!IDENTIFIER.test(table) || !IDENTIFIER.test(column)) {
    throw new Error(`Refusing to inspect suspicious identifier ${table}.${column}`);
  }

  if (dialect === 'postgres') {
    const res = await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS present`,
      [table, column],
    );
    return Boolean(res.rows[0]?.present);
  }

  const res = await client.query<{ name: string }>(`PRAGMA table_info(${table})`);
  return res.rows.some((row) => row.name === column);
}

function nowDefault(dialect: MigrationDialect): string {
  return dialect === 'postgres' ? 'NOW()' : "(datetime('now'))";
}

async function ensureMigrationTable(context: MigrationContext): Promise<void> {
  await context.client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version     TEXT PRIMARY KEY,
       description TEXT NOT NULL DEFAULT '',
       applied_at  ${context.dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT ${nowDefault(context.dialect)}
     )`,
  );
}

const BOOKING_DEPOSIT_INDEX = 'idx_bookings_deposit_type';

interface DepositColumnDefinition {
  type: string;
  length: number | null;
  nullable: boolean;
  default: string | null;
}

interface PostgresIndexDefinition {
  table_name: string;
  method: string;
  is_unique: boolean;
  is_valid: boolean;
  is_ready: boolean;
  has_predicate: boolean;
  has_expressions: boolean;
  key_count: number;
  total_count: number;
  key_column: string | null;
}

function normalizeDefault(value: string | null): string | null {
  if (value === null) return null;

  let normalized = value.trim();
  let unwrapped = true;
  while (unwrapped && normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim();
    unwrapped = normalized.startsWith('(') && normalized.endsWith(')');
  }
  normalized = normalized.replace(/::[a-z_][a-z0-9_ ]*(?:\(\d+\))?/gi, '').trim();
  return normalized.replace(/\s+/g, ' ');
}

async function readDepositColumn(
  client: MigrationClient,
  dialect: MigrationDialect,
  column: 'deposit_type' | 'deposit_value',
): Promise<DepositColumnDefinition | null> {
  if (dialect === 'postgres') {
    const result = await client.query<{
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT data_type, character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = $1`,
      [column],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      type: row.data_type,
      length: row.character_maximum_length === null ? null : Number(row.character_maximum_length),
      nullable: row.is_nullable !== 'NO',
      default: row.column_default,
    };
  }

  const result = await client.query<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>('PRAGMA table_info(bookings)');
  const row = result.rows.find((candidate) => candidate.name === column);
  if (!row) return null;
  return {
    type: row.type,
    length: null,
    nullable: Number(row.notnull) !== 1,
    default: row.dflt_value,
  };
}

function assertDepositColumn(
  column: DepositColumnDefinition,
  dialect: MigrationDialect,
  name: 'deposit_type' | 'deposit_value',
): void {
  const expectedType =
    dialect === 'postgres'
      ? name === 'deposit_type'
        ? 'character varying'
        : 'bigint'
      : name === 'deposit_type'
        ? 'TEXT'
        : 'INTEGER';
  const expectedLength = dialect === 'postgres' && name === 'deposit_type' ? 20 : null;
  const expectedDefault = name === 'deposit_type' ? "'percentage'" : '25';
  const expectedDefinition =
    dialect === 'postgres'
      ? name === 'deposit_type'
        ? "varchar(20) NOT NULL DEFAULT 'percentage'"
        : 'bigint NOT NULL DEFAULT 25'
      : name === 'deposit_type'
        ? "TEXT NOT NULL DEFAULT 'percentage'"
        : 'INTEGER NOT NULL DEFAULT 25';

  const actualType =
    dialect === 'postgres'
      ? `${column.type}${column.length === null ? '' : `(${column.length})`}`
      : column.type;
  const typeMismatch = column.type !== expectedType || (expectedLength !== null && column.length !== expectedLength);
  const defaultMismatch = normalizeDefault(column.default) !== expectedDefault;

  if (typeMismatch || column.nullable || defaultMismatch) {
    throw new Error(
      `Migration 001 schema drift: bookings.${name} is ${actualType}${column.nullable ? ' NULL' : ' NOT NULL'} DEFAULT ${column.default ?? 'none'}, expected ${expectedDefinition}.`,
    );
  }
}

async function assertDepositIndexCompatible(
  client: MigrationClient,
  dialect: MigrationDialect,
): Promise<boolean> {
  if (dialect === 'postgres') {
    const result = await client.query<PostgresIndexDefinition>(
      `SELECT t.relname AS table_name,
              am.amname AS method,
              ix.indisunique AS is_unique,
              ix.indisvalid AS is_valid,
              ix.indisready AS is_ready,
              ix.indpred IS NOT NULL AS has_predicate,
              ix.indexprs IS NOT NULL AS has_expressions,
              ix.indnkeyatts AS key_count,
              ix.indnatts AS total_count,
              a.attname AS key_column
         FROM pg_class i
         JOIN pg_index ix ON ix.indexrelid = i.oid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_am am ON am.oid = i.relam
         LEFT JOIN pg_attribute a
           ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
        WHERE i.relname = $1
          AND i.relnamespace = 'public'::regnamespace`,
      [BOOKING_DEPOSIT_INDEX],
    );

    if (result.rows.length === 0) return false;

    const index = result.rows[0];
    const compatible =
      result.rows.length === 1 &&
      index.table_name === 'bookings' &&
      index.method === 'btree' &&
      index.is_unique === false &&
      index.is_valid === true &&
      index.is_ready === true &&
      index.has_predicate === false &&
      index.has_expressions === false &&
      Number(index.key_count) === 1 &&
      Number(index.total_count) === 1 &&
      index.key_column === 'deposit_type';

    if (!compatible) {
      throw new Error(
        `Migration 001 schema drift: index ${BOOKING_DEPOSIT_INDEX} exists but is not the expected non-unique btree index on bookings(deposit_type).`,
      );
    }
    return true;
  }

  const master = await client.query<{ tbl_name: string; sql: string | null }>(
    `SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
    [BOOKING_DEPOSIT_INDEX],
  );
  if (!master.rows[0]) return false;

  const listed = await client.query<{ name: string; unique: number; partial: number }>(
    'PRAGMA index_list(bookings)',
  );
  const index = listed.rows.find((candidate) => candidate.name === BOOKING_DEPOSIT_INDEX);
  const info = await client.query<{ name: string | null }>(
    `PRAGMA index_info(${BOOKING_DEPOSIT_INDEX})`,
  );
  const compatible =
    master.rows[0].tbl_name === 'bookings' &&
    Boolean(master.rows[0].sql) &&
    Boolean(index) &&
    Number(index?.unique) === 0 &&
    Number(index?.partial) === 0 &&
    info.rows.length === 1 &&
    info.rows[0].name === 'deposit_type';

  if (!compatible) {
    throw new Error(
      `Migration 001 schema drift: index ${BOOKING_DEPOSIT_INDEX} exists but is not the expected non-unique index on bookings(deposit_type).`,
    );
  }
  return true;
}

/**
 * Deposit policy snapshot on a booking (see commit 2b860cf). Previously applied
 * lazily from `createBooking()`, which required DDL rights on a user request.
 */
const bookingDepositSnapshot: SchemaMigration = {
  id: '001_booking_deposit_snapshot',
  description: 'Add bookings.deposit_type / deposit_value so a quoted deposit policy is immutable',
  async up(context) {
    const { client, dialect } = context;

    const depositType = await readDepositColumn(client, dialect, 'deposit_type');
    const depositValue = await readDepositColumn(client, dialect, 'deposit_value');
    const indexExists = await assertDepositIndexCompatible(client, dialect);

    if (!depositType && !depositValue) {
      if (indexExists) {
        throw new Error(
          `Migration 001 schema drift: index ${BOOKING_DEPOSIT_INDEX} exists while both deposit columns are absent.`,
        );
      }

      await client.query(
        dialect === 'postgres'
          ? `ALTER TABLE bookings ADD COLUMN deposit_type VARCHAR(20) NOT NULL DEFAULT 'percentage'`
          : `ALTER TABLE bookings ADD COLUMN deposit_type TEXT NOT NULL DEFAULT 'percentage'`,
      );
      await client.query(
        dialect === 'postgres'
          ? 'ALTER TABLE bookings ADD COLUMN deposit_value BIGINT NOT NULL DEFAULT 25'
          : 'ALTER TABLE bookings ADD COLUMN deposit_value INTEGER NOT NULL DEFAULT 25',
      );
    } else if (!depositType || !depositValue) {
      const present = depositType ? 'deposit_type' : 'deposit_value';
      const missing = depositType ? 'deposit_value' : 'deposit_type';
      throw new Error(
        `Migration 001 schema drift: bookings.${present} exists while bookings.${missing} is missing. Both fields must be absent or both must be present and correct.`,
      );
    } else {
      assertDepositColumn(depositType, dialect, 'deposit_type');
      assertDepositColumn(depositValue, dialect, 'deposit_value');
    }

    if (!indexExists) {
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${BOOKING_DEPOSIT_INDEX} ON bookings(deposit_type)`,
      );
    }
  },
};

/**
 * Link an accepted enquiry to exactly one managed booking, and widen the
 * enquiry/booking status vocabularies so the admin workflow can distinguish
 * new/review/contacted/accepted/rejected enquiries from managed bookings.
 */
const enquiryBookingLifecycle: SchemaMigration = {
  id: '005_enquiry_booking_lifecycle',
  description: 'Link accepted enquiries to one booking and add the enquiry/booking workflow statuses',
  async up(context) {
    const { client, dialect } = context;

    if (!(await context.hasColumn('bookings', 'source_enquiry_id'))) {
      await client.query(
        dialect === 'postgres'
          ? 'ALTER TABLE bookings ADD COLUMN source_enquiry_id INTEGER'
          : 'ALTER TABLE bookings ADD COLUMN source_enquiry_id INTEGER REFERENCES event_enquiries(id) ON DELETE SET NULL',
      );
    }

    if (dialect === 'postgres') {
      const foreignKey = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'bookings_source_enquiry_fk' AND conrelid = 'bookings'::regclass`,
      );
      if (!foreignKey.rows[0]) {
        await client.query(
          `ALTER TABLE bookings
             ADD CONSTRAINT bookings_source_enquiry_fk
             FOREIGN KEY (source_enquiry_id) REFERENCES event_enquiries(id) ON DELETE SET NULL`,
        );
      }
    }

    if (!(await context.hasColumn('bookings', 'venue_location'))) {
      await client.query(`ALTER TABLE bookings ADD COLUMN venue_location TEXT NOT NULL DEFAULT ''`);
    }

    if (!(await context.hasColumn('event_enquiries', 'accepted_by'))) {
      await client.query(
        'ALTER TABLE event_enquiries ADD COLUMN accepted_by INTEGER REFERENCES users(id) ON DELETE SET NULL',
      );
    }

    if (!(await context.hasColumn('event_enquiries', 'accepted_at'))) {
      await client.query(
        dialect === 'postgres'
          ? 'ALTER TABLE event_enquiries ADD COLUMN accepted_at TIMESTAMPTZ'
          : 'ALTER TABLE event_enquiries ADD COLUMN accepted_at TEXT',
      );
    }

    if (!(await context.hasColumn('event_enquiries', 'rejection_reason'))) {
      await client.query(
        `ALTER TABLE event_enquiries ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT ''`,
      );
    }

    // Multiple NULLs are allowed; a non-NULL enquiry id can only ever own one
    // booking, which makes duplicate/concurrent acceptance impossible.
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_source_enquiry ON bookings(source_enquiry_id)',
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_event_enquiries_accepted_by ON event_enquiries(accepted_by)',
    );

    // PostgreSQL has CHECK constraints on the existing status columns. SQLite
    // fallbacks deliberately do not enforce them (the status values are
    // validated in the application layer).
    if (dialect === 'postgres') {
      await client.query(
        'ALTER TABLE event_enquiries DROP CONSTRAINT IF EXISTS event_enquiries_status_check',
      );
      await client.query(
        `ALTER TABLE event_enquiries ADD CONSTRAINT event_enquiries_status_check
           CHECK (status IN ('new', 'reviewing', 'contacted', 'quoted', 'accepted', 'rejected', 'confirmed', 'archived'))`,
      );

      await client.query('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check');
      await client.query(
        `ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
           CHECK (status IN ('draft', 'pending', 'confirmed', 'completed', 'cancelled', 'closed'))`,
      );
    }
  },
};

/**
 * Server-priced enquiry selections and admin quotation versions.
 *
 * Catalogue prices remain on the enquiry line snapshot; admin-agreed prices
 * live only on quotation lines. A quotation is versioned so edits are auditable
 * and acceptance can point at the exact agreed version.
 */
const enquiryQuotations: SchemaMigration = {
  id: '006_enquiry_quotations',
  description: 'Persist priced enquiry lines and versioned admin quotation lines',
  async up(context) {
    const { client, dialect } = context;
    const serial = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const money = dialect === 'postgres' ? 'BIGINT' : 'INTEGER';
    const timestamp = dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT';
    const now = dialect === 'postgres' ? 'NOW()' : "(datetime('now'))";

    if (!(await context.hasColumn('event_enquiries', 'pricing_status'))) {
      await client.query(
        `ALTER TABLE event_enquiries ADD COLUMN pricing_status VARCHAR(30) NOT NULL DEFAULT 'quotation_required'`,
      );
    }
    if (!(await context.hasColumn('event_enquiries', 'priced_subtotal_paise'))) {
      await client.query(
        `ALTER TABLE event_enquiries ADD COLUMN priced_subtotal_paise ${money} NOT NULL DEFAULT 0`,
      );
    }
    if (!(await context.hasColumn('event_enquiries', 'pricing_breakdown_json'))) {
      await client.query(
        `ALTER TABLE event_enquiries ADD COLUMN pricing_breakdown_json TEXT NOT NULL DEFAULT '{}'`,
      );
    }
    if (!(await context.hasColumn('event_enquiries', 'additional_services'))) {
      await client.query(
        `ALTER TABLE event_enquiries ADD COLUMN additional_services TEXT NOT NULL DEFAULT ''`,
      );
    }

    if (!(await context.hasColumn('enquiry_line_items', 'catalogue_unit_price_paise'))) {
      await client.query(
        `ALTER TABLE enquiry_line_items ADD COLUMN catalogue_unit_price_paise ${money}`,
      );
    }
    if (!(await context.hasColumn('enquiry_line_items', 'catalogue_subtotal_paise'))) {
      await client.query(
        `ALTER TABLE enquiry_line_items ADD COLUMN catalogue_subtotal_paise ${money}`,
      );
    }
    if (!(await context.hasColumn('enquiry_line_items', 'pricing_status'))) {
      await client.query(
        `ALTER TABLE enquiry_line_items ADD COLUMN pricing_status VARCHAR(20) NOT NULL DEFAULT 'on_request'`,
      );
    }
    if (!(await context.hasColumn('enquiry_line_items', 'metadata_json'))) {
      await client.query(
        `ALTER TABLE enquiry_line_items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`,
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS enquiry_quotations (
        id                   ${serial},
        enquiry_id           INTEGER NOT NULL REFERENCES event_enquiries(id) ON DELETE CASCADE,
        version              INTEGER NOT NULL DEFAULT 1,
        status               VARCHAR(20) NOT NULL DEFAULT 'prepared'
                               CHECK (status IN ('prepared', 'accepted', 'superseded')),
        priced_subtotal_paise ${money} NOT NULL DEFAULT 0,
        quoted_subtotal_paise ${money} NOT NULL DEFAULT 0,
        total_paise           ${money} NOT NULL DEFAULT 0,
        notes                 TEXT NOT NULL DEFAULT '',
        prepared_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        prepared_at           ${timestamp},
        accepted_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        accepted_at           ${timestamp},
        created_at            ${timestamp} NOT NULL DEFAULT ${now},
        updated_at            ${timestamp} NOT NULL DEFAULT ${now},
        UNIQUE (enquiry_id, version)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS enquiry_quotation_lines (
        id                        ${serial},
        quotation_id              INTEGER NOT NULL REFERENCES enquiry_quotations(id) ON DELETE CASCADE,
        enquiry_line_item_id      INTEGER REFERENCES enquiry_line_items(id) ON DELETE SET NULL,
        line_type                 VARCHAR(20) NOT NULL DEFAULT 'catalogue'
                                    CHECK (line_type IN ('catalogue', 'manual')),
        catalogue_item_id         INTEGER,
        description               VARCHAR(255) NOT NULL,
        quantity                  INTEGER NOT NULL DEFAULT 1,
        catalogue_unit_price_paise ${money},
        quoted_unit_price_paise   ${money} NOT NULL DEFAULT 0,
        quoted_subtotal_paise     ${money} NOT NULL DEFAULT 0,
        notes                     TEXT NOT NULL DEFAULT '',
        created_at                ${timestamp} NOT NULL DEFAULT ${now}
      )`);

    if (!(await context.hasColumn('event_enquiries', 'accepted_quotation_id'))) {
      await client.query('ALTER TABLE event_enquiries ADD COLUMN accepted_quotation_id INTEGER');
      if (dialect === 'postgres') {
        await client.query(
          `ALTER TABLE event_enquiries
             ADD CONSTRAINT event_enquiries_accepted_quotation_fk
             FOREIGN KEY (accepted_quotation_id) REFERENCES enquiry_quotations(id) ON DELETE SET NULL`,
        );
      }
    }
    if (!(await context.hasColumn('bookings', 'source_quotation_id'))) {
      await client.query('ALTER TABLE bookings ADD COLUMN source_quotation_id INTEGER');
      if (dialect === 'postgres') {
        await client.query(
          `ALTER TABLE bookings
             ADD CONSTRAINT bookings_source_quotation_fk
             FOREIGN KEY (source_quotation_id) REFERENCES enquiry_quotations(id) ON DELETE SET NULL`,
        );
      }
    }

    if (dialect === 'postgres') {
      const acceptedQuoteFk = await client.query(
        `SELECT 1 FROM pg_constraint
          WHERE conname = 'event_enquiries_accepted_quotation_fk'
            AND conrelid = 'event_enquiries'::regclass`,
      );
      if (!acceptedQuoteFk.rows[0]) {
        await client.query(
          `ALTER TABLE event_enquiries
             ADD CONSTRAINT event_enquiries_accepted_quotation_fk
             FOREIGN KEY (accepted_quotation_id) REFERENCES enquiry_quotations(id) ON DELETE SET NULL`,
        );
      }

      const sourceQuoteFk = await client.query(
        `SELECT 1 FROM pg_constraint
          WHERE conname = 'bookings_source_quotation_fk'
            AND conrelid = 'bookings'::regclass`,
      );
      if (!sourceQuoteFk.rows[0]) {
        await client.query(
          `ALTER TABLE bookings
             ADD CONSTRAINT bookings_source_quotation_fk
             FOREIGN KEY (source_quotation_id) REFERENCES enquiry_quotations(id) ON DELETE SET NULL`,
        );
      }
    }

    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_enquiry_quotations_enquiry ON enquiry_quotations(enquiry_id)',
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_enquiry_quotation_lines_quote ON enquiry_quotation_lines(quotation_id)',
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_enquiry_quotation_lines_line ON enquiry_quotation_lines(enquiry_line_item_id)',
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_bookings_source_quotation ON bookings(source_quotation_id)',
    );
  },
};

/**
 * Content publication ledger. Previously created lazily by the Content Studio.
 */
const contentPublications: SchemaMigration = {
  id: '002_content_publications',
  description: 'Create the content_publications ledger used by the publishing workflow',
  async up({ client }) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_publications (
        id                 TEXT PRIMARY KEY,
        requested_by       INTEGER,
        requested_by_name  TEXT NOT NULL DEFAULT '',
        status             TEXT NOT NULL DEFAULT 'requested',
        requested_version  TEXT NOT NULL DEFAULT '',
        built_version      TEXT NOT NULL DEFAULT '',
        published_version  TEXT NOT NULL DEFAULT '',
        deploy_hook_status INTEGER,
        deployment_id      TEXT NOT NULL DEFAULT '',
        deployment_url     TEXT NOT NULL DEFAULT '',
        error              TEXT NOT NULL DEFAULT '',
        requested_at       TEXT NOT NULL,
        built_at           TEXT,
        completed_at       TEXT
      )`);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_content_publications_status ON content_publications(status)',
    );
  },
};

/**
 * Active public-content pointer and publication history.
 *
 * Filebase cannot enforce conditional writes (see
 * docs/filebase-compatibility-audit.md), so the single mutable pointer that
 * decides which immutable manifest is live must live in a store that supports
 * compare-and-swap. That store is Neon.
 *
 * `content_pointers` holds exactly one row (`id = 'active'`). Its
 * `site_version` is the expected-version token used by
 * `UPDATE … WHERE id = 'active' AND site_version = $expected`.
 *
 * An empty `site_version` means "nothing published from the new store yet" and
 * is what makes the D1 fallback the safe default before cutover.
 */
const contentReleases: SchemaMigration = {
  id: '003_content_releases',
  description: 'Create the active content pointer and publication history used by the Filebase content store',
  async up({ client, dialect }) {
    const timestamp = dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT';
    const now = dialect === 'postgres' ? 'NOW()' : "(datetime('now'))";

    await client.query(`
      CREATE TABLE IF NOT EXISTS content_pointers (
        id              TEXT PRIMARY KEY,
        site_version    TEXT NOT NULL DEFAULT '',
        manifest_key    TEXT NOT NULL DEFAULT '',
        manifest_sha256 TEXT NOT NULL DEFAULT '',
        publication_id  TEXT NOT NULL DEFAULT '',
        updated_at      ${timestamp} NOT NULL DEFAULT ${now},
        updated_by      INTEGER
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS content_releases (
        id                TEXT PRIMARY KEY,
        site_version      TEXT NOT NULL UNIQUE,
        status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','uploading','verified','published','failed','conflicted','rolled_back')),
        expected_version  TEXT NOT NULL DEFAULT '',
        manifest_key      TEXT NOT NULL DEFAULT '',
        manifest_sha256   TEXT NOT NULL DEFAULT '',
        pages_json        TEXT NOT NULL DEFAULT '{}',
        published_by      INTEGER,
        published_by_name TEXT NOT NULL DEFAULT '',
        error             TEXT NOT NULL DEFAULT '',
        created_at        ${timestamp} NOT NULL DEFAULT ${now},
        updated_at        ${timestamp} NOT NULL DEFAULT ${now},
        completed_at      ${timestamp},
        rolled_back_to    TEXT NOT NULL DEFAULT ''
      )`);

    await client.query('CREATE INDEX IF NOT EXISTS idx_content_releases_status ON content_releases(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_content_releases_created ON content_releases(created_at DESC)');

    // The pointer row must exist before anything compares-and-swaps against it.
    await client.query(
      dialect === 'postgres'
        ? `INSERT INTO content_pointers (id, site_version) VALUES ('active', '')
           ON CONFLICT (id) DO NOTHING`
        : `INSERT OR IGNORE INTO content_pointers (id, site_version) VALUES ('active', '')`,
    );
  },
};


/**
 * Drafts for the Content Studio editor.
 *
 * A draft is one JSON document per page plus a revision counter. Saving uses
 * `WHERE revision = $expected`, so two administrators editing the same page get
 * a visible conflict instead of silently overwriting each other.
 */
const contentDrafts: SchemaMigration = {
  id: '004_content_drafts',
  description: 'Create the Content Studio draft store for object-storage page content',
  async up({ client, dialect }) {
    const timestamp = dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT';
    const now = dialect === 'postgres' ? 'NOW()' : "(datetime('now'))";

    await client.query(`
      CREATE TABLE IF NOT EXISTS content_drafts (
        page_id           TEXT PRIMARY KEY,
        document_json     TEXT NOT NULL,
        revision          INTEGER NOT NULL DEFAULT 1,
        base_site_version TEXT NOT NULL DEFAULT '',
        updated_by        TEXT NOT NULL DEFAULT '',
        updated_at        ${timestamp} NOT NULL DEFAULT ${now}
      )`);
  },
};

export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  bookingDepositSnapshot,
  contentPublications,
  contentReleases,
  contentDrafts,
  enquiryBookingLifecycle,
  enquiryQuotations,
];

export function migrationDialect(client: MigrationClient): MigrationDialect {
  return client.isUsingRemote?.() ? 'postgres' : 'sqlite';
}

export interface MigrationRunResult {
  dialect: MigrationDialect;
  applied: string[];
  skipped: string[];
}

/**
 * Applies every pending migration in order. Safe to run repeatedly: applied
 * versions are recorded in `schema_migrations` and each migration also checks
 * the live schema before changing it.
 */
export async function applyMigrations(
  client: MigrationClient,
  migrations: SchemaMigration[] = SCHEMA_MIGRATIONS,
): Promise<MigrationRunResult> {
  const dialect = migrationDialect(client);
  const context: MigrationContext = {
    client,
    dialect,
    hasColumn: (table, column) => hasColumn(client, dialect, table, column),
  };

  await ensureMigrationTable(context);

  const existing = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
  const recorded = new Set(existing.rows.map((row) => row.version));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (recorded.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }

    await migration.up(context);

    await client.query(
      dialect === 'postgres'
        ? `INSERT INTO schema_migrations (version, description) VALUES ($1, $2)
           ON CONFLICT (version) DO NOTHING`
        : `INSERT OR IGNORE INTO schema_migrations (version, description) VALUES ($1, $2)`,
      [migration.id, migration.description],
    );

    applied.push(migration.id);
  }

  return { dialect, applied, skipped };
}

/** Reports which migrations are pending, without changing anything. */
export async function migrationStatus(
  client: MigrationClient,
  migrations: SchemaMigration[] = SCHEMA_MIGRATIONS,
): Promise<{ dialect: MigrationDialect; applied: string[]; pending: string[] }> {
  const dialect = migrationDialect(client);
  const context: MigrationContext = {
    client,
    dialect,
    hasColumn: (table, column) => hasColumn(client, dialect, table, column),
  };

  let applied: string[] = [];
  try {
    const existing = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    applied = existing.rows.map((row) => row.version);
  } catch {
    // The bookkeeping table does not exist yet: nothing has been applied.
    applied = [];
  }

  const appliedSet = new Set(applied);
  return {
    dialect,
    applied,
    pending: migrations.filter((migration) => !appliedSet.has(migration.id)).map((migration) => migration.id),
  };
}
