import { getD1Client, type D1Client } from '../src/core/content/d1-client';

interface ColumnMigration {
  table: string;
  column: string;
  definition: string;
}

const COLUMN_MIGRATIONS: ColumnMigration[] = [
  { table: 'mandaps', column: 'full_description', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'mandaps', column: 'image_alt', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'mandaps', column: 'is_archived', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'mandaps', column: 'archived_at', definition: 'TEXT' },
  { table: 'mandap_gallery', column: 'alt_text', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'mandap_gallery', column: 'is_visible', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'stages', column: 'full_description', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'stages', column: 'image_alt', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'stages', column: 'is_archived', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'stages', column: 'archived_at', definition: 'TEXT' },
  { table: 'stage_gallery', column: 'alt_text', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'stage_gallery', column: 'is_visible', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'furniture_items', column: 'full_description', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'furniture_items', column: 'image_alt', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'furniture_items', column: 'is_featured', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'furniture_items', column: 'is_archived', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'furniture_items', column: 'archived_at', definition: 'TEXT' },
  { table: 'catering_packages', column: 'full_description', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'catering_packages', column: 'image_alt', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'catering_packages', column: 'category', definition: "TEXT NOT NULL DEFAULT 'Signature'" },
  { table: 'catering_packages', column: 'is_archived', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'catering_packages', column: 'archived_at', definition: 'TEXT' },
];

const TABLE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS furniture_item_images (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     item_id INTEGER NOT NULL REFERENCES furniture_items(id) ON DELETE CASCADE,
     image_url TEXT NOT NULL,
     alt_text TEXT NOT NULL DEFAULT '',
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_furniture_item_images_item ON furniture_item_images(item_id)`,
  `CREATE TABLE IF NOT EXISTS catering_package_images (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     package_id INTEGER NOT NULL REFERENCES catering_packages(id) ON DELETE CASCADE,
     image_url TEXT NOT NULL,
     alt_text TEXT NOT NULL DEFAULT '',
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_catering_package_images_package ON catering_package_images(package_id)`,
];

async function hasColumn(client: D1Client, table: string, column: string): Promise<boolean> {
  const result = await client.query<{ name: string }>(`PRAGMA table_info(${table})`);
  return (result.results ?? []).some((row) => row.name === column);
}

export async function migrateCatalogueAdmin(client: D1Client = getD1Client()): Promise<{
  addedColumns: string[];
  createdTables: boolean;
}> {
  const addedColumns: string[] = [];

  for (const migration of COLUMN_MIGRATIONS) {
    if (await hasColumn(client, migration.table, migration.column)) continue;
    await client.query(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`);
    addedColumns.push(`${migration.table}.${migration.column}`);
  }

  await client.batch(TABLE_MIGRATIONS.map((sql) => ({ sql })));
  return { addedColumns, createdTables: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateCatalogueAdmin()
    .then((result) => console.log('Catalogue admin migration complete:', result))
    .catch((error) => {
      console.error('Catalogue admin migration failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
