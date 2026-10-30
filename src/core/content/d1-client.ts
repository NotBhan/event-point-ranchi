import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { d1SchemaSql } from './d1-schema';

export interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: {
    duration?: number;
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

export interface D1ApiResponse<T = Record<string, unknown>> {
  result: Array<{
    results: T[];
    success: boolean;
    meta: {
      duration?: number;
      changes?: number;
      last_row_id?: number;
      rows_read?: number;
      rows_written?: number;
    };
  }>;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

export interface D1ClientConfig {
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  localDbPath?: string;
}

export class D1Client {
  private accountId?: string;
  private databaseId?: string;
  private apiToken?: string;
  private localDb: DatabaseSync | null = null;
  private isRemote = false;

  constructor(config?: D1ClientConfig) {
    if (typeof process !== 'undefined' && process.loadEnvFile) {
      try { process.loadEnvFile(); } catch {}
    }
    this.accountId =
      config?.accountId !== undefined
        ? config.accountId
        : (process.env.CLOUDFLARE_ACCOUNT_ID ||
          (typeof import.meta !== 'undefined' && import.meta.env?.CLOUDFLARE_ACCOUNT_ID));
    this.databaseId =
      config?.databaseId !== undefined
        ? config.databaseId
        : (process.env.CLOUDFLARE_DATABASE_ID ||
          (typeof import.meta !== 'undefined' && import.meta.env?.CLOUDFLARE_DATABASE_ID));
    this.apiToken =
      config?.apiToken !== undefined
        ? config.apiToken
        : (process.env.CLOUDFLARE_API_TOKEN ||
          (typeof import.meta !== 'undefined' && import.meta.env?.CLOUDFLARE_API_TOKEN));

    if (this.accountId && this.databaseId && this.apiToken) {
      this.isRemote = true;
    } else {
      const isProduction = Boolean(
        process.env.VERCEL ||
        process.env.VERCEL_ENV ||
        (process.env.NODE_ENV === 'production' && !process.env.TEST && !process.env.VITEST)
      );
      if (isProduction && !config?.localDbPath) {
        throw new Error(
          '[Cloudflare D1] Missing required credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_API_TOKEN) in production environment. Silent fallback to local SQLite is disabled in production.'
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
    const isVercelEnv = Boolean(
      process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.NOW_REGION ||
      (typeof import.meta !== 'undefined' && (import.meta.env?.VERCEL || import.meta.env?.VERCEL_ENV))
    );
    const dbDir = isVercelEnv ? '/tmp/data' : resolve(process.cwd(), './data');
    mkdirSync(dbDir, { recursive: true });
    const filePath = customPath || join(dbDir, 'event-point-d1.db');
    if (isVercelEnv && !existsSync(filePath)) {
      const bundled = resolve(process.cwd(), './data/event-point-d1.db');
      if (existsSync(bundled)) {
        try { copyFileSync(bundled, filePath); } catch {}
      }
    }
    this.localDb = new DatabaseSync(filePath);
    this.localDb.exec(d1SchemaSql);
  }

  /**
   * Executes a parameterized SQL query against Cloudflare D1 HTTP API or local fallback.
   */
  public async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<D1QueryResult<T>> {
    if (this.isRemote) {
      return this.queryRemote<T>(sql, params);
    }
    return this.queryLocal<T>(sql, params);
  }

  /**
   * Executes multiple queries in a batch.
   */
  public async batch<T = Record<string, unknown>>(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<Array<D1QueryResult<T>>> {
    if (this.isRemote) {
      return this.batchRemote<T>(statements);
    }
    const results: Array<D1QueryResult<T>> = [];
    for (const stmt of statements) {
      results.push(this.queryLocal<T>(stmt.sql, stmt.params || []));
    }
    return results;
  }

  private async queryRemote<T>(sql: string, params: unknown[]): Promise<D1QueryResult<T>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
    const cleanParams = params.map((p) => (p === undefined ? null : p));

    const maxRetries = 3;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params: cleanParams }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
          // Retry on rate limit or server error
          const backoff = attempt * 250;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        const data = (await response.json()) as D1ApiResponse<T>;
        if (!response.ok || !data.success) {
          const errMsg = data.errors?.map((e) => e.message).join(', ') || response.statusText;
          throw new Error(`Cloudflare D1 Query Failed (${response.status}): ${errMsg}`);
        }

        const firstResult = data.result?.[0];
        return {
          results: firstResult?.results || [],
          success: true,
          meta: firstResult?.meta || {},
        };
      } catch (err: unknown) {
        lastError = err as Error;
        if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 250));
            continue;
          }
        }
        if (attempt >= maxRetries) {
          throw new Error(`Cloudflare D1 query error after ${maxRetries} attempts: ${lastError?.message}`);
        }
      }
    }

    throw lastError || new Error('D1 remote query failed');
  }

  private async batchRemote<T>(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<Array<D1QueryResult<T>>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
    const cleaned = statements.map((s) => ({
      sql: s.sql,
      params: (s.params || []).map((p) => (p === undefined ? null : p)),
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cleaned),
      signal: AbortSignal.timeout(8000),
    });

    const data = (await response.json()) as D1ApiResponse<T>;
    if (!response.ok || !data.success) {
      const errMsg = data.errors?.map((e) => e.message).join(', ') || response.statusText;
      throw new Error(`Cloudflare D1 Batch Failed (${response.status}): ${errMsg}`);
    }

    return (data.result || []).map((r) => ({
      results: r.results || [],
      success: r.success,
      meta: r.meta || {},
    }));
  }

  private queryLocal<T>(sql: string, params: unknown[]): D1QueryResult<T> {
    if (!this.localDb) {
      this.initLocalDb();
    }
    const cleanParams = params.map((p) => (p === undefined ? null : p));
    const stmt = this.localDb!.prepare(sql);

    // Detect if statement is read or write
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH')) {
      const rows = stmt.all(...(cleanParams as never[])) as T[];
      return {
        results: rows,
        success: true,
        meta: { rows_read: rows.length, duration: 0 },
      };
    } else {
      const result = stmt.run(...(cleanParams as never[]));
      return {
        results: [],
        success: true,
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
          rows_written: Number(result.changes),
        },
      };
    }
  }

  public close(): void {
    if (this.localDb) {
      this.localDb.close();
      this.localDb = null;
    }
  }
}

let d1Instance: D1Client | null = null;

export function getD1Client(): D1Client {
  if (!d1Instance) {
    d1Instance = new D1Client();
  }
  return d1Instance;
}

export function resetD1Client(): void {
  d1Instance?.close();
  d1Instance = null;
}
