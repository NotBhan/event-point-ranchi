import { getD1Client } from '../src/core/content/d1-client';
import { saveVideoPreview } from '../src/core/content/service';

async function main() {
  if (typeof process !== 'undefined' && process.loadEnvFile) {
    try { process.loadEnvFile(); } catch {}
  }

  console.log('--- Applying Video Previews D1 Migration ---');
  const d1 = getD1Client();
  console.log(`D1 isUsingRemote: ${d1.isUsingRemote()}`);

  // 1. Create video_previews table
  await d1.query(`
    CREATE TABLE IF NOT EXISTS video_previews (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      platform      TEXT NOT NULL,
      video_url     TEXT NOT NULL,
      video_id      TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      aspect_ratio  TEXT NOT NULL DEFAULT '16:9',
      is_featured   INTEGER NOT NULL DEFAULT 0,
      is_published  INTEGER NOT NULL DEFAULT 1,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await d1.query(`CREATE INDEX IF NOT EXISTS idx_video_previews_platform ON video_previews(platform);`);
  await d1.query(`CREATE INDEX IF NOT EXISTS idx_video_previews_published ON video_previews(is_published);`);
  await d1.query(`CREATE INDEX IF NOT EXISTS idx_video_previews_sort ON video_previews(sort_order);`);

  console.log('✓ video_previews table and indexes created');

  // 2. Check if table is empty, seed initial high quality preview entries
  const countRes = await d1.query<{ count: number }>('SELECT COUNT(*) as count FROM video_previews');
  const count = countRes.results?.[0]?.count ?? 0;
  console.log(`Current video_previews count: ${count}`);

  if (count === 0) {
    console.log('Seeding initial video previews...');

    const sampleVideos = [
      {
        title: 'Grand Wedding Mandap & Event Setup Tour',
        description: 'Complete walkthrough of our flagship royal mandap and ambient lighting decor in Ranchi.',
        video_url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
        is_featured: true,
        is_published: true,
        sort_order: 1,
      },
      {
        title: 'Luxury Floral Mandap Entry · Quick Glance',
        description: 'Fresh orchid & marigold ceiling canopy with handcrafted brass pillars.',
        video_url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        is_featured: true,
        is_published: true,
        sort_order: 2,
      },
      {
        title: 'Royal Stage Lighting & Varmala Setup Ranchi',
        description: 'Candid moments and fireworks stage reveal from a destination wedding.',
        video_url: 'https://www.instagram.com/reel/C3_abc123/',
        thumbnail_url: '/storage/assets/banners/homepage/banner-hero.webp',
        is_featured: false,
        is_published: true,
        sort_order: 3,
      },
    ];

    for (const video of sampleVideos) {
      await saveVideoPreview(video);
      console.log(`  + Seeded: ${video.title} (${video.video_url})`);
    }
  }

  console.log('✓ Video previews migration completed successfully.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
