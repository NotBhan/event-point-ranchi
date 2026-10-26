import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import schemaSql from './schema.sql?raw';
import { hashPassword, verifyPassword } from './password';
import { seedDatabase } from './seed';

let database: DatabaseSync | null = null;

export function dataDir(): string {
  const configured = process.env.DATA_DIR || import.meta.env.DATA_DIR;
  if (configured) return resolve(process.cwd(), configured);
  if (process.env.VERCEL) return '/tmp/data';
  return resolve(process.cwd(), './data');
}

export function uploadsDir(): string {
  const dir = join(dataDir(), 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): DatabaseSync {
  if (database) return database;

  mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(join(dataDir(), 'event-point.db'));
  db.exec(schemaSql);
  migrateTrafficEvents(db);

  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (!row || Number(row.count) === 0) {
    seedDatabase(db);
  }

  ensureAdminUser(db);

  database = db;
  return db;
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

export function cleanParams(params: unknown[]): unknown[] {
  return params.map((v) => (v === undefined ? null : v));
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(cleanParams(params) as never[])) as T[];
}

export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(cleanParams(params) as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): { changes: number; lastId: number } {
  const result = getDb().prepare(sql).run(...(cleanParams(params) as never[]));
  return {
    changes: Number(result.changes),
    lastId: Number(result.lastInsertRowid),
  };
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
  database?.close();
  database = null;
}
