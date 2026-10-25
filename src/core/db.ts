import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import schemaSql from './schema.sql?raw';
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
  const db = new DatabaseSync(join(dataDir(), 'royal-palace.db'));
  db.exec(schemaSql);

  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (!row || Number(row.count) === 0) {
    seedDatabase(db);
  }

  database = db;
  return db;
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): { changes: number; lastId: number } {
  const result = getDb().prepare(sql).run(...(params as never[]));
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
