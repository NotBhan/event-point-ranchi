import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  SCHEMA_MIGRATIONS,
  applyMigrations,
  type MigrationClient,
  type MigrationContext,
} from '../src/core/operational/migrations';

const migration = SCHEMA_MIGRATIONS.find((candidate) => candidate.id === '001_booking_deposit_snapshot')!;
if (!migration) throw new Error('001_booking_deposit_snapshot is missing');

class SqliteMigrationClient implements MigrationClient {
  constructor(public readonly db: DatabaseSync) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const statement = this.db.prepare(sql.replace(/\$(\d+)/g, '?'));
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.startsWith('WITH')) {
      const rows = statement.all(...(params as never[])) as T[];
      return { rows, rowCount: rows.length };
    }
    const result = statement.run(...(params as never[]));
    return { rows: [] as T[], rowCount: Number(result.changes) };
  }

  isUsingRemote(): boolean {
    return false;
  }
}

interface SqliteColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

interface SqliteIndexRow {
  name: string;
  tbl_name: string;
  sql: string | null;
}

function sqliteClient(columns = ''): SqliteMigrationClient {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL
    ${columns}
  )`);
  return new SqliteMigrationClient(db);
}

function bookingColumns(client: SqliteMigrationClient): SqliteColumn[] {
  return client.db.prepare('PRAGMA table_info(bookings)').all() as unknown as SqliteColumn[];
}

function depositIndexes(client: SqliteMigrationClient): SqliteIndexRow[] {
  return client.db
    .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .all('idx_bookings_deposit_type') as unknown as SqliteIndexRow[];
}

function applyOne(client: MigrationClient) {
  return applyMigrations(client, [migration]);
}

test('001 adds both deposit columns and the index when both are absent', async () => {
  const client = sqliteClient();
  client.db.prepare("INSERT INTO bookings (customer_name) VALUES ('Existing booking')").run();

  await applyOne(client);

  const columns = bookingColumns(client);
  const typeColumn = columns.find((column) => column.name === 'deposit_type');
  const valueColumn = columns.find((column) => column.name === 'deposit_value');
  assert.equal(typeColumn?.type, 'TEXT');
  assert.equal(typeColumn?.notnull, 1);
  assert.equal(typeColumn?.dflt_value, "'percentage'");
  assert.equal(valueColumn?.type, 'INTEGER');
  assert.equal(valueColumn?.notnull, 1);
  assert.equal(valueColumn?.dflt_value, '25');
  assert.equal(depositIndexes(client).length, 1);

  const booking = client.db
    .prepare('SELECT customer_name, deposit_type, deposit_value FROM bookings')
    .get() as { customer_name: string; deposit_type: string; deposit_value: number };
  assert.deepEqual({ ...booking }, {
    customer_name: 'Existing booking',
    deposit_type: 'percentage',
    deposit_value: 25,
  });
});

test('001 preserves correct existing columns and values while creating a missing index', async () => {
  const client = sqliteClient(
    ", deposit_type TEXT NOT NULL DEFAULT 'percentage', deposit_value INTEGER NOT NULL DEFAULT 25",
  );
  client.db
    .prepare("INSERT INTO bookings (customer_name, deposit_type, deposit_value) VALUES ('Keep me', 'fixed', 40)")
    .run();

  await applyOne(client);

  const booking = client.db
    .prepare('SELECT customer_name, deposit_type, deposit_value FROM bookings')
    .get() as { customer_name: string; deposit_type: string; deposit_value: number };
  assert.deepEqual({ ...booking }, { customer_name: 'Keep me', deposit_type: 'fixed', deposit_value: 40 });
  assert.equal(depositIndexes(client).length, 1);
});

test('001 rejects when only deposit_type exists', async () => {
  const client = sqliteClient(", deposit_type TEXT NOT NULL DEFAULT 'percentage'");

  await assert.rejects(() => applyOne(client), /both fields must be absent or both must be present/i);
  assert.equal(bookingColumns(client).some((column) => column.name === 'deposit_value'), false);
  assert.equal(depositIndexes(client).length, 0);
});

test('001 rejects when only deposit_value exists', async () => {
  const client = sqliteClient(', deposit_value INTEGER NOT NULL DEFAULT 25');

  await assert.rejects(() => applyOne(client), /both fields must be absent or both must be present/i);
  assert.equal(bookingColumns(client).some((column) => column.name === 'deposit_type'), false);
  assert.equal(depositIndexes(client).length, 0);
});

test('001 rejects an incorrect deposit_type type', async () => {
  const client = sqliteClient(
    ", deposit_type VARCHAR(10) NOT NULL DEFAULT 'percentage', deposit_value INTEGER NOT NULL DEFAULT 25",
  );

  await assert.rejects(() => applyOne(client), /deposit_type.*expected TEXT/i);
  assert.equal(depositIndexes(client).length, 0);
});

test('001 rejects incorrect nullability', async () => {
  const client = sqliteClient(
    ", deposit_type TEXT DEFAULT 'percentage', deposit_value INTEGER NOT NULL DEFAULT 25",
  );

  await assert.rejects(() => applyOne(client), /deposit_type.*NULL.*expected TEXT/i);
  assert.equal(depositIndexes(client).length, 0);
});

test('001 rejects an incorrect default', async () => {
  const client = sqliteClient(
    ", deposit_type TEXT NOT NULL DEFAULT 'fixed', deposit_value INTEGER NOT NULL DEFAULT 25",
  );

  await assert.rejects(() => applyOne(client), /deposit_type.*DEFAULT 'fixed'.*expected/i);
  assert.equal(depositIndexes(client).length, 0);
});

test('001 accepts an existing compatible index without duplicating it', async () => {
  const client = sqliteClient(
    ", deposit_type TEXT NOT NULL DEFAULT 'percentage', deposit_value INTEGER NOT NULL DEFAULT 25",
  );
  client.db.exec('CREATE INDEX idx_bookings_deposit_type ON bookings(deposit_type)');

  await applyOne(client);

  assert.equal(depositIndexes(client).length, 1);
});

test('001 rejects an existing conflicting index and leaves the table unchanged', async () => {
  const client = sqliteClient(
    ", deposit_type TEXT NOT NULL DEFAULT 'percentage', deposit_value INTEGER NOT NULL DEFAULT 25",
  );
  client.db.exec('CREATE UNIQUE INDEX idx_bookings_deposit_type ON bookings(deposit_type)');
  client.db.prepare("INSERT INTO bookings (customer_name) VALUES ('Untouched')").run();

  await assert.rejects(() => applyOne(client), /index idx_bookings_deposit_type exists/i);
  assert.equal(bookingColumns(client).some((column) => column.name === 'deposit_type'), true);
  assert.equal(
    client.db.prepare("SELECT customer_name FROM bookings WHERE customer_name = 'Untouched'").get() !== undefined,
    true,
  );
});

interface PostgresColumn {
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

class PostgresMigrationClient implements MigrationClient {
  readonly ddl: string[] = [];

  constructor(
    private readonly columns: Record<string, PostgresColumn>,
    private readonly indexes: Array<Record<string, unknown>> = [],
  ) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    if (sql.includes('FROM information_schema.columns')) {
      const column = String(params[0]);
      const definition = this.columns[column];
      return {
        rows: (definition ? [definition] : []) as T[],
        rowCount: definition ? 1 : 0,
      };
    }
    if (sql.includes('FROM pg_class i')) {
      return { rows: this.indexes as T[], rowCount: this.indexes.length };
    }
    if (sql.trim().startsWith('ALTER TABLE') || sql.trim().startsWith('CREATE INDEX')) {
      this.ddl.push(sql);
      return { rows: [] as T[], rowCount: 0 };
    }
    throw new Error(`Unexpected PostgreSQL query: ${sql}`);
  }

  isUsingRemote(): boolean {
    return true;
  }
}

function postgresContext(client: PostgresMigrationClient): MigrationContext {
  return {
    client,
    dialect: 'postgres',
    hasColumn: async () => false,
  };
}

function exactPostgresColumns(): Record<string, PostgresColumn> {
  return {
    deposit_type: {
      data_type: 'character varying',
      character_maximum_length: 20,
      is_nullable: 'NO',
      column_default: "'percentage'::character varying",
    },
    deposit_value: {
      data_type: 'bigint',
      character_maximum_length: null,
      is_nullable: 'NO',
      column_default: '25',
    },
  };
}

test('001 accepts exact PostgreSQL definitions and creates only the missing index', async () => {
  const client = new PostgresMigrationClient(exactPostgresColumns());

  await migration.up(postgresContext(client));

  assert.equal(client.ddl.some((statement) => statement.startsWith('ALTER TABLE')), false);
  assert.equal(client.ddl.some((statement) => statement.includes('CREATE INDEX')), true);
});

test('001 adds both PostgreSQL deposit columns when both are absent', async () => {
  const client = new PostgresMigrationClient({});

  await migration.up(postgresContext(client));

  assert.equal(client.ddl.filter((statement) => statement.startsWith('ALTER TABLE')).length, 2);
  assert.equal(client.ddl.filter((statement) => statement.includes('CREATE INDEX')).length, 1);
});

test('001 rejects PostgreSQL nullability drift before any DDL', async () => {
  const columns = exactPostgresColumns();
  columns.deposit_type.is_nullable = 'YES';
  const client = new PostgresMigrationClient(columns);

  await assert.rejects(() => migration.up(postgresContext(client)), /deposit_type.*NULL.*expected/i);
  assert.deepEqual(client.ddl, []);
});

test('001 rejects PostgreSQL type drift before any DDL', async () => {
  const columns = exactPostgresColumns();
  columns.deposit_type.data_type = 'text';
  columns.deposit_type.character_maximum_length = null;
  const client = new PostgresMigrationClient(columns);

  await assert.rejects(() => migration.up(postgresContext(client)), /deposit_type.*expected varchar\(20\)/i);
  assert.deepEqual(client.ddl, []);
});

test('001 rejects PostgreSQL default drift before any DDL', async () => {
  const columns = exactPostgresColumns();
  columns.deposit_value.column_default = '30';
  const client = new PostgresMigrationClient(columns);

  await assert.rejects(() => migration.up(postgresContext(client)), /deposit_value.*expected bigint/i);
  assert.deepEqual(client.ddl, []);
});

test('001 rejects a PostgreSQL index with the wrong actual definition', async () => {
  const client = new PostgresMigrationClient(exactPostgresColumns(), [
    {
      table_name: 'bookings',
      method: 'btree',
      is_unique: true,
      is_valid: true,
      is_ready: true,
      has_predicate: false,
      has_expressions: false,
      key_count: 1,
      total_count: 1,
      key_column: 'deposit_type',
    },
  ]);

  await assert.rejects(() => migration.up(postgresContext(client)), /index idx_bookings_deposit_type exists/i);
  assert.deepEqual(client.ddl, []);
});
