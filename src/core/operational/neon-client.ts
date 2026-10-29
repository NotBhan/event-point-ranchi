import { Pool } from '@neondatabase/serverless';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface OperationalQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface NeonClientConfig {
  databaseUrl?: string;
  localDbPath?: string;
}

export class NeonOperationalClient {
  private databaseUrl?: string;
  private isRemote = false;
  private localDb: DatabaseSync | null = null;
  private pool: Pool | null = null;

  constructor(config?: NeonClientConfig) {
    if (typeof process !== 'undefined' && process.loadEnvFile) {
      try { process.loadEnvFile(); } catch {}
    }
    this.databaseUrl =
      config?.databaseUrl !== undefined
        ? config.databaseUrl
        : (process.env.DATABASE_URL ||
          (typeof import.meta !== 'undefined' && import.meta.env?.DATABASE_URL));

    if (this.databaseUrl) {
      this.isRemote = true;
    } else {
      const isProduction = Boolean(
        process.env.VERCEL ||
        process.env.VERCEL_ENV ||
        (process.env.NODE_ENV === 'production' && !process.env.TEST && !process.env.VITEST)
      );
      if (isProduction && !config?.localDbPath) {
        throw new Error(
          '[Neon PostgreSQL] Missing required DATABASE_URL in production environment. Silent fallback to local SQLite is disabled in production.'
        );
      }
      this.isRemote = false;
      this.initLocalDb(config?.localDbPath);
    }
  }

  public isUsingRemote(): boolean {
    return this.isRemote;
  }

  private initLocalDb(customPath?: string): void {
    if (this.localDb) return;
    const dbDir = resolve(process.cwd(), './data');
    mkdirSync(dbDir, { recursive: true });
    const filePath = customPath || join(dbDir, 'event-point-neon-fallback.db');
    this.localDb = new DatabaseSync(filePath);
    this.initSqliteFallbackSchema();
  }

  private initSqliteFallbackSchema(): void {
    if (!this.localDb) return;
    // Adapt Postgres schema types for SQLite fallback
    this.localDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email         TEXT UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        first_name    TEXT NOT NULL DEFAULT '',
        role          TEXT NOT NULL DEFAULT 'customer',
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
        status          TEXT NOT NULL DEFAULT 'pending',
        total_amount    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS booking_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        category      TEXT NOT NULL,
        item_id       TEXT NOT NULL DEFAULT '',
        item_name     TEXT NOT NULL,
        quantity      INTEGER NOT NULL DEFAULT 1,
        unit_price    INTEGER NOT NULL DEFAULT 0,
        subtotal      INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

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
        status               TEXT NOT NULL DEFAULT 'new',
        created_at           TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS enquiry_line_items (
        id                           INTEGER PRIMARY KEY AUTOINCREMENT,
        enquiry_id                   INTEGER NOT NULL REFERENCES event_enquiries(id) ON DELETE CASCADE,
        item_type                    TEXT NOT NULL,
        catalogue_item_id            INTEGER,
        item_name_snapshot           TEXT NOT NULL,
        quantity                     INTEGER NOT NULL DEFAULT 1,
        standard_dimensions_snapshot TEXT NOT NULL DEFAULT '',
        requested_length_ft          REAL,
        requested_width_ft           REAL,
        requested_height_ft          REAL,
        specifications               TEXT NOT NULL DEFAULT '',
        notes                        TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        phone       TEXT NOT NULL,
        email       TEXT NOT NULL,
        event_type  TEXT NOT NULL DEFAULT '',
        event_date  TEXT,
        guest_count INTEGER,
        message     TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'new',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS traffic_events (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id       TEXT NOT NULL,
        path             TEXT NOT NULL,
        referrer         TEXT NOT NULL DEFAULT 'direct',
        device_type      TEXT NOT NULL DEFAULT 'desktop',
        browser          TEXT NOT NULL DEFAULT 'Other',
        os               TEXT NOT NULL DEFAULT 'Other',
        city             TEXT NOT NULL DEFAULT 'Ranchi',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        utm_source       TEXT NOT NULL DEFAULT '',
        utm_medium       TEXT NOT NULL DEFAULT '',
        utm_campaign     TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS storage_objects (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id           TEXT NOT NULL UNIQUE,
        storage_category    TEXT NOT NULL CHECK (storage_category IN ('gallery', 'asset')),
        entity_type         TEXT NOT NULL,
        entity_id           TEXT NOT NULL DEFAULT '',
        slot                TEXT NOT NULL DEFAULT 'primary',
        object_key          TEXT NOT NULL UNIQUE,
        public_url          TEXT NOT NULL,
        mime_type           TEXT NOT NULL,
        size_bytes          INTEGER NOT NULL,
        width               INTEGER,
        height              INTEGER,
        format              TEXT NOT NULL,
        original_filename   TEXT NOT NULL DEFAULT '',
        status              TEXT NOT NULL DEFAULT 'active',
        deletion_attempts   INTEGER NOT NULL DEFAULT 0,
        last_deletion_error TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS storage_reservations (
        id               TEXT PRIMARY KEY,
        storage_category TEXT NOT NULL CHECK (storage_category IN ('gallery', 'asset')),
        reserved_bytes   INTEGER NOT NULL,
        entity_type      TEXT NOT NULL,
        entity_id        TEXT NOT NULL DEFAULT '',
        expires_at       TEXT NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id   TEXT NOT NULL DEFAULT '',
        details     TEXT NOT NULL DEFAULT '{}',
        ip_address  TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Run a query using parameterized values.
   */
  public async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<OperationalQueryResult<T>> {
    if (this.isRemote) {
      return this.queryRemote<T>(sql, params);
    }
    return this.queryLocal<T>(sql, params);
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: this.databaseUrl });
    }
    return this.pool;
  }

  private async queryRemote<T>(sql: string, params: unknown[]): Promise<OperationalQueryResult<T>> {
    const res = await this.getPool().query(sql, params);
    return {
      rows: (res.rows || []) as T[],
      rowCount: res.rowCount || 0,
    };
  }

  private queryLocal<T>(sql: string, params: unknown[]): OperationalQueryResult<T> {
    if (!this.localDb) {
      this.initLocalDb();
    }
    // Convert $1, $2, ... to ? for SQLite compatibility if needed
    const sqliteSql = sql.replace(/\$(\d+)/g, '?');
    const cleanParams = params.map((p) => (p === undefined ? null : p));

    const trimmed = sqliteSql.trim().toUpperCase();
    const stmt = this.localDb!.prepare(sqliteSql);

    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.startsWith('PRAGMA')) {
      const rows = stmt.all(...(cleanParams as never[])) as T[];
      return {
        rows,
        rowCount: rows.length,
      };
    } else {
      const result = stmt.run(...(cleanParams as never[]));
      return {
        rows: [],
        rowCount: Number(result.changes),
      };
    }
  }

  /**
   * Run a transaction.
   */
  public async tx<R>(callback: (client: NeonOperationalClient) => Promise<R>): Promise<R> {
    if (this.isRemote) {
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const txAdapter = {
          query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
            const res = await client.query(sql, params);
            return { rows: (res.rows || []) as T[], rowCount: res.rowCount || 0 };
          },
          isUsingRemote: () => true,
          tx: async () => { throw new Error('Nested transactions not supported'); },
        } as unknown as NeonOperationalClient;

        const result = await callback(txAdapter);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      if (!this.localDb) this.initLocalDb();
      this.localDb!.exec('BEGIN');
      try {
        const result = await callback(this);
        this.localDb!.exec('COMMIT');
        return result;
      } catch (err) {
        this.localDb!.exec('ROLLBACK');
        throw err;
      }
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    if (this.localDb) {
      this.localDb.close();
      this.localDb = null;
    }
  }
}

let neonInstance: NeonOperationalClient | null = null;

export function getNeonClient(): NeonOperationalClient {
  if (!neonInstance) {
    neonInstance = new NeonOperationalClient();
  }
  return neonInstance;
}

export async function resetNeonClient(): Promise<void> {
  await neonInstance?.close();
  neonInstance = null;
}
