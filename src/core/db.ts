import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteSchemaSql as schemaSql } from './sqlite-schema';
import { hashPassword, verifyPassword } from './password';
import { seedDatabase } from './seed';
import { initStorageSchema } from './storage/schema';
import { recordDb } from './perf';

// Module state lives on globalThis: the Astro server build can emit modules in
// several chunks, which would otherwise open multiple SQLite handles (and
// multiple prepared-statement caches) per process.
interface DbGlobalScope {
  __eventPointDatabase?: DatabaseSync | null;
  __eventPointStatementCache?: Map<string, ReturnType<DatabaseSync['prepare']>>;
}

const dbScope = globalThis as typeof globalThis & DbGlobalScope;
const STATEMENT_CACHE_MAX = 200;

function statementCache(): Map<string, ReturnType<DatabaseSync['prepare']>> {
  if (!dbScope.__eventPointStatementCache) {
    dbScope.__eventPointStatementCache = new Map();
  }
  return dbScope.__eventPointStatementCache;
}

export function isVercel(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.NOW_REGION ||
    (typeof import.meta !== 'undefined' && (import.meta.env?.VERCEL || import.meta.env?.VERCEL_ENV))
  );
}

export function dataDir(): string {
  if (isVercel()) return '/tmp/data';
  const configured = process.env.DATA_DIR || (typeof import.meta !== 'undefined' && import.meta.env?.DATA_DIR);
  if (configured) return resolve(process.cwd(), configured);
  return resolve(process.cwd(), './data');
}

export function uploadsDir(): string {
  const dir = join(dataDir(), 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Bump when schema.sql / migrations change so the guard below re-runs them.
const SQLITE_SCHEMA_VERSION = 3;

export function getDb(): DatabaseSync {
  if (dbScope.__eventPointDatabase) return dbScope.__eventPointDatabase;

  const targetDir = dataDir();
  mkdirSync(targetDir, { recursive: true });
  const dbPath = join(targetDir, 'event-point.db');

  if (isVercel() && !existsSync(dbPath)) {
    const bundledCandidates = [
      resolve(process.cwd(), './data/event-point.db'),
      resolve(process.cwd(), 'data/event-point.db'),
      '/var/task/data/event-point.db',
    ];
    for (const candidate of bundledCandidates) {
      if (existsSync(candidate)) {
        try {
          copyFileSync(candidate, dbPath);
          break;
        } catch (err) {
          console.warn('[db] Could not copy bundled database to /tmp:', err);
        }
      }
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');

  const currentVersion = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0,
  );

  if (currentVersion < SQLITE_SCHEMA_VERSION) {
    const startedAt = performance.now();
    db.exec(schemaSql);
    migrateTrafficEvents(db);
    migrateUsersRole(db);
    migrateBookingsFinancials(db);
    initStorageSchema(db);
    db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION}`);
    console.log(`[db] schema initialised in ${(performance.now() - startedAt).toFixed(1)}ms (version ${currentVersion} -> ${SQLITE_SCHEMA_VERSION})`);
  }

  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (!row || Number(row.count) === 0) {
    seedDatabase(db);
  }

  ensureAdminUser(db);
  ensureEditorUser(db);

  statementCache().clear();
  dbScope.__eventPointDatabase = db;
  return db;
}

function migrateUsersRole(db: DatabaseSync): void {
  const tableSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql?: string })?.sql || '';
  if (tableSql && !tableSql.includes("'editor'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users_migrated (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email         TEXT UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        first_name    TEXT NOT NULL DEFAULT '',
        role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'editor', 'admin', 'superadmin', 'developer')),
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_migrated (id, username, email, password_hash, first_name, role, is_active, created_at)
        SELECT id, username, email, password_hash, first_name, role, is_active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_migrated RENAME TO users;
      PRAGMA foreign_keys = ON;
    `);
  }
}

function migrateTrafficEvents(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(traffic_events)').all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));

  for (const column of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (!existing.has(column)) {
      db.exec(`ALTER TABLE traffic_events ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_traffic_events_campaign ON traffic_events(utm_source, utm_campaign)');
}

function migrateBookingsFinancials(db: DatabaseSync): void {
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bookings'").get();
  if (!tableCheck) return;

  const columns = db.prepare('PRAGMA table_info(bookings)').all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));

  const columnsToAdd: Array<{ name: string; ddl: string }> = [
    { name: 'advance_amount', ddl: 'ALTER TABLE bookings ADD COLUMN advance_amount INTEGER NOT NULL DEFAULT 0' },
    { name: 'amount_paid', ddl: 'ALTER TABLE bookings ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0' },
    { name: 'outstanding_balance', ddl: 'ALTER TABLE bookings ADD COLUMN outstanding_balance INTEGER NOT NULL DEFAULT 0' },
    { name: 'payment_status', ddl: "ALTER TABLE bookings ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'" },
  ];

  for (const { name, ddl } of columnsToAdd) {
    if (!existing.has(name)) {
      db.exec(ddl);
    }
  }

  db.exec(`
    UPDATE bookings
    SET outstanding_balance = total_amount
    WHERE (outstanding_balance = 0 OR outstanding_balance IS NULL)
      AND (amount_paid = 0 OR amount_paid IS NULL)
      AND total_amount > 0;
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status)');
}

function ensureAdminUser(db: DatabaseSync): void {
  const adminPassword =
    process.env.ADMIN_PASSWORD ||
    (typeof import.meta !== 'undefined' && import.meta.env?.ADMIN_PASSWORD) ||
    'admin';

  const existing = db
    .prepare("SELECT id, password_hash, role, is_active FROM users WHERE username = 'admin' COLLATE NOCASE")
    .get() as { id: number; password_hash: string; role: string; is_active: number } | undefined;

  if (existing) {
    if (
      !verifyPassword(adminPassword, existing.password_hash) ||
      existing.is_active !== 1 ||
      existing.role !== 'developer'
    ) {
      db.prepare("UPDATE users SET password_hash = ?, role = 'developer', is_active = 1 WHERE id = ?").run(
        hashPassword(adminPassword),
        existing.id,
      );
    }
    return;
  }

  db.prepare(
    "INSERT INTO users (username, email, password_hash, first_name, role, is_active) VALUES ('admin', 'admin@eventpointranchi.com', ?, 'Administrator', 'developer', 1)",
  ).run(hashPassword(adminPassword));
}

function ensureEditorUser(db: DatabaseSync): void {
  const editorPassword =
    process.env.EDITOR_PASSWORD ||
    (typeof import.meta !== 'undefined' && import.meta.env?.EDITOR_PASSWORD) ||
    'Editor@Royal2026!';

  const existing = db
    .prepare("SELECT id, password_hash, role, is_active FROM users WHERE username = 'content_editor' COLLATE NOCASE")
    .get() as { id: number; password_hash: string; role: string; is_active: number } | undefined;

  if (existing) {
    if (
      !verifyPassword(editorPassword, existing.password_hash) ||
      existing.is_active !== 1 ||
      existing.role !== 'editor'
    ) {
      db.prepare("UPDATE users SET password_hash = ?, role = 'editor', is_active = 1 WHERE id = ?").run(
        hashPassword(editorPassword),
        existing.id,
      );
    }
    return;
  }

  db.prepare(
    "INSERT INTO users (username, email, password_hash, first_name, role, is_active) VALUES ('content_editor', 'editor@eventpointranchi.com', ?, 'Content Editor', 'editor', 1)",
  ).run(hashPassword(editorPassword));
}

export function cleanParams(params: unknown[]): unknown[] {
  return params.map((v) => (v === undefined ? null : v));
}

function prepared(sql: string): ReturnType<DatabaseSync['prepare']> {
  const cache = statementCache();
  const cached = cache.get(sql);
  if (cached) return cached;

  const stmt = getDb().prepare(sql);
  if (cache.size >= STATEMENT_CACHE_MAX) cache.clear();
  cache.set(sql, stmt);
  return stmt;
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const startedAt = performance.now();
  try {
    return prepared(sql).all(...(cleanParams(params) as never[])) as T[];
  } finally {
    recordDb('sqlite', performance.now() - startedAt, sql);
  }
}

export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const startedAt = performance.now();
  try {
    return prepared(sql).get(...(cleanParams(params) as never[])) as T | undefined;
  } finally {
    recordDb('sqlite', performance.now() - startedAt, sql);
  }
}

export function run(sql: string, params: unknown[] = []): { changes: number; lastId: number } {
  const startedAt = performance.now();
  try {
    const result = prepared(sql).run(...(cleanParams(params) as never[]));
    return {
      changes: Number(result.changes),
      lastId: Number(result.lastInsertRowid),
    };
  } finally {
    recordDb('sqlite', performance.now() - startedAt, sql);
  }
}

export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeDb(): void {
  dbScope.__eventPointDatabase?.close();
  dbScope.__eventPointDatabase = null;
  statementCache().clear();
}
