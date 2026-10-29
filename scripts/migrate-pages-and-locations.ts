import { getD1Client } from '../src/core/content/d1-client';
import { defaultPageContent } from '../src/core/content/service';

async function main() {
  if (typeof process !== 'undefined' && process.loadEnvFile) {
    try { process.loadEnvFile(); } catch {}
  }

  console.log('--- Applying Page Content & Mandap Map Locations Schema Migration ---');
  const d1 = getD1Client();
  console.log(`D1 isUsingRemote: ${d1.isUsingRemote()}`);

  // 1. Create page_content table
  await d1.query(`
    CREATE TABLE IF NOT EXISTS page_content (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      page_key         TEXT NOT NULL UNIQUE,
      title            TEXT NOT NULL DEFAULT '',
      subtitle         TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      banner_image_url TEXT NOT NULL DEFAULT '',
      banner_enabled   INTEGER NOT NULL DEFAULT 1,
      content_json     TEXT NOT NULL DEFAULT '{}',
      seo_title        TEXT NOT NULL DEFAULT '',
      seo_description  TEXT NOT NULL DEFAULT '',
      og_image_url     TEXT NOT NULL DEFAULT '',
      published        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await d1.query(`CREATE INDEX IF NOT EXISTS idx_page_content_key ON page_content(page_key);`);
  console.log('✓ page_content table and index established');

  // 2. Add columns to mandaps idempotently
  const mandapCols = [
    "ALTER TABLE mandaps ADD COLUMN location_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE mandaps ADD COLUMN address TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE mandaps ADD COLUMN latitude REAL",
    "ALTER TABLE mandaps ADD COLUMN longitude REAL",
    "ALTER TABLE mandaps ADD COLUMN google_maps_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE mandaps ADD COLUMN directions_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE mandaps ADD COLUMN show_location INTEGER NOT NULL DEFAULT 0",
  ];

  for (const sql of mandapCols) {
    try {
      await d1.query(sql);
      console.log(`  Added column to mandaps: ${sql.split('ADD COLUMN ')[1]}`);
    } catch (e: any) {
      if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
        // Column already exists, safe to ignore
      } else {
        console.warn(`  Notice on mandaps alter: ${e.message}`);
      }
    }
  }

  // 3. Add columns to site_settings idempotently
  const siteCols = [
    "ALTER TABLE site_settings ADD COLUMN google_maps_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE site_settings ADD COLUMN latitude REAL",
    "ALTER TABLE site_settings ADD COLUMN longitude REAL",
    "ALTER TABLE site_settings ADD COLUMN footer_text TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE site_settings ADD COLUMN contact_buttons_enabled INTEGER NOT NULL DEFAULT 1",
  ];

  for (const sql of siteCols) {
    try {
      await d1.query(sql);
      console.log(`  Added column to site_settings: ${sql.split('ADD COLUMN ')[1]}`);
    } catch (e: any) {
      if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
        // Column already exists, safe to ignore
      } else {
        console.warn(`  Notice on site_settings alter: ${e.message}`);
      }
    }
  }

  // 4. Seed 6 page_content records idempotently
  for (const [, p] of Object.entries(defaultPageContent)) {
    await d1.query(
      `INSERT INTO page_content (
        page_key, title, subtitle, description, banner_image_url, banner_enabled,
        content_json, seo_title, seo_description, og_image_url, published
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (page_key) DO NOTHING`,
      [
        p.page_key,
        p.title,
        p.subtitle,
        p.description,
        p.banner_image_url,
        p.banner_enabled ? 1 : 0,
        JSON.stringify(p.content_json),
        p.seo_title,
        p.seo_description,
        p.og_image_url,
      ],
    );
  }
  console.log('✓ Seeded 6 pages into page_content');

  // 5. Verify records
  const pagesRes = await d1.query<{ page_key: string; title: string }>('SELECT page_key, title FROM page_content ORDER BY page_key');
  console.log('\nVerified Page Content in D1:');
  for (const r of pagesRes.results || []) {
    console.log(`  - [${r.page_key}]: "${r.title}"`);
  }

  console.log('\n--- Migration complete! ---');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
