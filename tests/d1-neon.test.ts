import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getD1Client } from '../src/core/content/d1-client';
import {
  getSiteSettings,
  getHomepageContent,
  getServices,
  getMandaps,
  getStages,
  getFurnitureCategories,
  getFurnitureItems,
  getCateringPackages,
  getRooms,
  getGalleryCategories,
  getGalleryItems,
  getSeoSettings,
  invalidateContentCache,
  getPageContent,
  listAllPageContent,
  savePageContent,
  saveMandapLocation,
  validateCoordinates,
  validateExternalUrl,
  getMandapBySlug,
  parseVideoUrl,
  getVideoPreviews,
  getVideoPreviewById,
  saveVideoPreview,
  deleteVideoPreview,
  toggleVideoPreview,
} from '../src/core/content/service';
import { getNeonClient } from '../src/core/operational/neon-client';
import {
  findUserByLogin,
  authenticate,
  listUsers,
  getContactInquiries,
  getEventEnquiries,
  getBookings,
  getStorageLedgerUsage,
  getStorageLedgerObjects,
} from '../src/core/operational/service';

test('1. Cloudflare D1 Client - initializes and queries content tables', async () => {
  const d1 = getD1Client();
  assert.ok(d1, 'D1 client must be instantiable');

  const res = await d1.query<{ count: number }>('SELECT COUNT(*) as count FROM site_settings');
  assert.ok(Array.isArray(res.results), 'results should be an array');
  assert.ok(res.results.length > 0, 'should return at least 1 row');
  assert.equal(Number(res.results[0].count), 1, 'site_settings should have 1 global row');
});

test('2. Cloudflare D1 - Site Settings retrieval and cache invalidation', async () => {
  // Clear any cache first
  invalidateContentCache();

  const settingsBefore = await getSiteSettings();
  assert.ok(settingsBefore.name, 'site settings should have a brand name');
  assert.equal(settingsBefore.name, 'Event Point Ranchi');
  assert.ok(settingsBefore.theme.primaryColor, 'should have theme primary color');

  // Direct update on D1
  const d1 = getD1Client();
  const testTagline = `Premier Test Wedding Decorators - ${Date.now()}`;
  await d1.query("UPDATE site_settings SET tagline = ? WHERE id = 'global'", [testTagline]);

  // Cached read should still return previous value
  const cachedSettings = await getSiteSettings();
  assert.notEqual(cachedSettings.tagline, testTagline, 'read within TTL should be served from in-memory cache');

  // Invalidate cache
  invalidateContentCache();
  const freshSettings = await getSiteSettings();
  assert.equal(freshSettings.tagline, testTagline, 'read after invalidation must reflect D1 database update');
});

test('3. Cloudflare D1 - Content service catalogue queries', async () => {
  const [services, mandaps, stages, furnitureCats, furnitureItems, catering, rooms, galleryCats, galleryItems, home, seo] =
    await Promise.all([
      getServices(),
      getMandaps(),
      getStages(),
      getFurnitureCategories(),
      getFurnitureItems(),
      getCateringPackages(),
      getRooms(),
      getGalleryCategories(),
      getGalleryItems(),
      getHomepageContent(),
      getSeoSettings('home'),
    ]);

  assert.ok(services.length > 0, 'Services should return entries from D1');
  assert.ok(mandaps.length > 0, 'Mandaps should return entries from D1');
  assert.ok(mandaps[0].length_ft > 0, 'Mandap dimensions should be parsed');
  assert.ok(stages.length > 0, 'Stages should return entries from D1');
  assert.ok(furnitureCats.length > 0, 'Furniture categories should return entries');
  assert.ok(furnitureItems.length > 0, 'Furniture items should return entries');
  assert.ok(catering.length > 0, 'Catering packages should return entries');
  assert.ok(rooms.length > 0, 'Rooms should return entries');
  assert.ok(galleryCats.length > 0, 'Gallery categories should return entries');
  assert.ok(galleryItems.length > 0, 'Gallery items should return entries');
  assert.ok(home.heroHeading, 'Homepage hero heading should be present');
  assert.ok(seo?.title, 'Home page SEO title should be present');
});

test('4. Neon PostgreSQL Client - connects and executes queries', async () => {
  const neon = getNeonClient();
  assert.ok(neon, 'Neon operational client must be instantiable');

  const res = await neon.query<{ num: number }>('SELECT 1 as num');
  assert.ok(Array.isArray(res.rows), 'Neon should return rows array');
  assert.equal(Number(res.rows[0].num), 1, 'SELECT 1 should return 1');
});

test('5. Neon PostgreSQL - User authentication and PBKDF2 password verification', async () => {
  // Test finding user by username and by email
  const superadminByLogin = await findUserByLogin('superadmin@eventpointranchi.com');
  assert.ok(superadminByLogin, 'Superadmin user should be found by login email');
  assert.equal(superadminByLogin?.role, 'superadmin');

  const superadminByUsername = await findUserByLogin('superadmin');
  assert.ok(superadminByUsername, 'Superadmin user should be found by username');
  assert.equal(superadminByUsername?.id, superadminByLogin?.id);

  // Authenticate with valid password
  const authenticatedUser = await authenticate('superadmin@eventpointranchi.com', 'Super@Royal2026!');
  assert.ok(authenticatedUser, 'Superadmin should authenticate with valid password');
  assert.equal(authenticatedUser?.email, 'superadmin@eventpointranchi.com');

  // Authenticate with invalid password
  const failedAuth = await authenticate('superadmin@eventpointranchi.com', 'WrongPassword123!');
  assert.equal(failedAuth, null, 'Authentication should fail with wrong password');

  // Test editor user role
  const editor = await findUserByLogin('editor@eventpointranchi.com');
  assert.ok(editor, 'Editor user should exist in Neon');
  assert.equal(editor?.role, 'editor');

  const authEditor = await authenticate('editor@eventpointranchi.com', 'Editor@Royal2026!');
  assert.ok(authEditor, 'Editor should authenticate with credentials');
  assert.equal(authEditor?.role, 'editor');
});

test('6. Neon PostgreSQL - Operational data reads (customers, inquiries, enquiries, bookings)', async () => {
  const users = await listUsers();
  assert.ok(users.length >= 10, 'Should have at least 10 migrated users in Neon');

  const inquiries = await getContactInquiries();
  assert.ok(Array.isArray(inquiries), 'Should return contact inquiries array');
  assert.ok(inquiries.length >= 2, 'Should have migrated contact inquiries in Neon');

  const enquiries = await getEventEnquiries();
  assert.ok(Array.isArray(enquiries), 'Should return event enquiries array');
  assert.ok(enquiries.length >= 5, 'Should have migrated event enquiries in Neon');

  const bookings = await getBookings();
  assert.ok(Array.isArray(bookings), 'Should return bookings array');
  assert.ok(bookings.length >= 5, 'Should have migrated bookings in Neon');
});

test('7. Neon PostgreSQL - Storage ledger integration', async () => {
  const galleryUsage = await getStorageLedgerUsage('gallery');
  assert.ok(typeof galleryUsage === 'number', 'Gallery usage should return a number');
  assert.ok(galleryUsage >= 0, 'Gallery usage should be >= 0');

  const assetUsage = await getStorageLedgerUsage('asset');
  assert.ok(typeof assetUsage === 'number', 'Asset usage should return a number');
  assert.ok(assetUsage > 0, 'Asset usage should be > 0 bytes');

  const objects = await getStorageLedgerObjects();
  assert.ok(objects.length >= 90, 'Storage objects ledger should contain at least 90 registered objects');
});

test('8. Architectural Boundary Verification', async () => {
  const d1 = getD1Client();
  const neon = getNeonClient();

  // Verify that D1 schema has content tables and NOT user operational tables
  const d1Tables = await d1.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'bookings', 'customers', 'site_settings', 'mandaps')",
  );
  const d1TableNames = (d1Tables.results || []).map((t) => t.name);
  assert.ok(d1TableNames.includes('site_settings'), 'D1 should contain site_settings');
  assert.ok(d1TableNames.includes('mandaps'), 'D1 should contain mandaps');
  assert.ok(!d1TableNames.includes('users'), 'D1 must NOT contain users table');
  assert.ok(!d1TableNames.includes('bookings'), 'D1 must NOT contain bookings table');

  // Verify that Neon has operational tables and NOT content presentation tables
  const neonUsersRes = await neon.query<{ count: number }>("SELECT COUNT(*) as count FROM users");
  assert.ok(Number(neonUsersRes.rows[0].count) >= 10, 'Neon must contain users');

  const neonBookingsRes = await neon.query<{ count: number }>("SELECT COUNT(*) as count FROM bookings");
  assert.ok(Number(neonBookingsRes.rows[0].count) >= 5, 'Neon must contain bookings');
});

test('9. Production Fallback Safety - rejects unconfigured fallback in production', async () => {
  const { D1Client } = await import('../src/core/content/d1-client');
  const { NeonOperationalClient } = await import('../src/core/operational/neon-client');

  const prevVercel = process.env.VERCEL;
  const prevCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const prevCfDb = process.env.CLOUDFLARE_DATABASE_ID;
  const prevCfToken = process.env.CLOUDFLARE_API_TOKEN;
  const prevDbUrl = process.env.DATABASE_URL;

  try {
    process.env.VERCEL = '1';
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_DATABASE_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.DATABASE_URL;

    assert.throws(
      () => new D1Client({ accountId: '', databaseId: '', apiToken: '' }),
      /Missing required credentials.*in production environment/,
      'D1Client must throw when credentials are missing in production',
    );
    assert.throws(
      () => new NeonOperationalClient({ databaseUrl: '' }),
      /Missing required DATABASE_URL in production environment/,
      'NeonOperationalClient must throw when DATABASE_URL is missing in production',
    );
  } finally {
    if (prevVercel !== undefined) process.env.VERCEL = prevVercel; else delete process.env.VERCEL;
    if (prevCfAccount !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAccount;
    if (prevCfDb !== undefined) process.env.CLOUDFLARE_DATABASE_ID = prevCfDb;
    if (prevCfToken !== undefined) process.env.CLOUDFLARE_API_TOKEN = prevCfToken;
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
  }
});

test('10. Cloudflare D1 - Dynamic Page Content CRUD for all 6 pages', async () => {
  invalidateContentCache();

  // 1. All 6 pages must be present
  const allPages = await listAllPageContent(true);
  const pageKeys = allPages.map((p) => p.page_key).sort();
  const expectedKeys = ['catering', 'equipment', 'gallery', 'home', 'mandaps', 'stages'].sort();
  assert.deepEqual(pageKeys, expectedKeys, 'D1 page_content should contain all 6 core pages');

  // 2. Fetch specific page (catering)
  const cateringBefore = await getPageContent('catering', true);
  assert.ok(cateringBefore.title, 'Catering page must have a title');

  // 3. Update catering page content
  const testTitle = `Royal Feasts & Catering - ${Date.now()}`;
  const testSubtitle = 'Curated culinary experiences for grand celebrations in Ranchi.';
  await savePageContent('catering', {
    title: testTitle,
    subtitle: testSubtitle,
    content_json: { badge: 'Exclusive Kitchen' },
    banner_enabled: true,
    published: true,
    seo_title: `${testTitle} | Event Point Ranchi`,
    seo_description: testSubtitle,
  });

  // Invalidate cache and verify update
  invalidateContentCache();
  const cateringAfter = await getPageContent('catering', true);
  assert.equal(cateringAfter.title, testTitle, 'Updated page title must match');
  assert.equal(cateringAfter.subtitle, testSubtitle, 'Updated subtitle must match');
  assert.equal(cateringAfter.seo_title, `${testTitle} | Event Point Ranchi`, 'Synchronized SEO title must match');

  // Also verify SEO table synchronized
  const cateringSeo = await getSeoSettings('catering');
  assert.ok(cateringSeo, 'SEO table should have entry for catering');
  assert.equal(cateringSeo.title, `${testTitle} | Event Point Ranchi`);
});

test('11. Cloudflare D1 - Mandap Map Locations & Coordinate Validation', async () => {
  // 1. Validation tests
  assert.equal(validateCoordinates(95, 85).valid, false);
  assert.match(validateCoordinates(95, 85).error || '', /Latitude must be between -90 and 90/);
  assert.equal(validateCoordinates(-91, 85).valid, false);
  assert.match(validateCoordinates(-91, 85).error || '', /Latitude must be between -90 and 90/);
  assert.equal(validateCoordinates(23, 185).valid, false);
  assert.match(validateCoordinates(23, 185).error || '', /Longitude must be between -180 and 180/);
  assert.equal(validateCoordinates(23, -181).valid, false);
  assert.match(validateCoordinates(23, -181).error || '', /Longitude must be between -180 and 180/);
  assert.equal(validateCoordinates(23.3441, 85.3096).valid, true);

  assert.equal(validateExternalUrl('javascript:alert(1)'), false);
  assert.equal(validateExternalUrl('https://maps.google.com/?q=23.3441,85.3096'), true);

  // Rejections in saveMandapLocation
  await assert.rejects(
    () => saveMandapLocation(1, { latitude: 95 }),
    /Latitude must be between -90 and 90/,
  );
  await assert.rejects(
    () => saveMandapLocation(1, { google_maps_url: 'javascript:alert(1)' }),
    /Google Maps URL must be a valid HTTP or HTTPS link/,
  );

  // 2. Get first mandap
  const mandaps = await getMandaps(true);
  assert.ok(mandaps.length > 0, 'Should have mandap designs');
  const targetMandap = mandaps[0];

  // 3. Update mandap physical location
  const testLocName = `Showroom Pavilion Alpha - ${Date.now()}`;
  const testAddress = 'Morabadi Grounds, Ranchi, Jharkhand 834008';
  const testLat = 23.385012;
  const testLon = 85.328045;
  const testMapsUrl = `https://maps.google.com/?q=${testLat},${testLon}`;
  const testDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${testLat},${testLon}`;

  await saveMandapLocation(targetMandap.id, {
    location_name: testLocName,
    address: testAddress,
    latitude: testLat,
    longitude: testLon,
    google_maps_url: testMapsUrl,
    directions_url: testDirUrl,
    show_location: true,
  });

  // Invalidate and read back
  invalidateContentCache();
  const updatedMandap = await getMandapBySlug(targetMandap.slug, true);
  assert.ok(updatedMandap, 'Mandap should be found by slug');
  assert.equal(updatedMandap.location_name, testLocName, 'Location name should match');
  assert.equal(updatedMandap.address, testAddress, 'Address should match');
  assert.ok(Math.abs((updatedMandap.latitude ?? 0) - testLat) < 0.0001, 'Latitude should match');
  assert.ok(Math.abs((updatedMandap.longitude ?? 0) - testLon) < 0.0001, 'Longitude should match');
  assert.equal(updatedMandap.google_maps_url, testMapsUrl, 'Google Maps URL should match');
  assert.equal(updatedMandap.directions_url, testDirUrl, 'Directions URL should match');
  assert.equal(updatedMandap.show_location, true, 'show_location should be true');
});

test('12. Cloudflare D1 - Editable Business Contact Details & Dynamic Settings', async () => {
  invalidateContentCache();
  const settings = await getSiteSettings();

  assert.ok(settings.name, 'Brand name should be present');
  assert.ok(settings.phone, 'Phone number should be present');
  assert.ok(settings.whatsapp, 'WhatsApp number should be present');
  assert.ok(settings.email, 'Email address should be present');
  assert.ok(settings.address, 'Registered office address should be present');
  assert.ok(settings.venueAddress, 'Venue warehouse address should be present');
  assert.ok(settings.businessHours, 'Business hours should be present');
  assert.ok(settings.googleMapsUrl, 'Google Maps URL should be present');
  assert.ok(typeof settings.latitude === 'number', 'Latitude should be a number');
  assert.ok(typeof settings.longitude === 'number', 'Longitude should be a number');
  assert.equal(settings.contactButtonsEnabled, true, 'Contact buttons should be enabled by default');
});

test('13. Video URL Parser - YouTube, YouTube Shorts & Instagram Reels extraction', () => {
  // Standard YouTube Watch URL
  const ytWatch = parseVideoUrl('https://www.youtube.com/watch?v=ScMzIvxBSi4');
  assert.equal(ytWatch.valid, true, 'Standard YouTube URL must be valid');
  assert.equal(ytWatch.platform, 'youtube', 'Platform should be youtube');
  assert.equal(ytWatch.videoId, 'ScMzIvxBSi4', 'Video ID should match 11 chars');
  assert.equal(ytWatch.aspectRatio, '16:9', 'Standard video must be 16:9');
  assert.ok(ytWatch.embedUrl.includes('youtube-nocookie.com/embed/ScMzIvxBSi4'), 'Must use nocookie embed');

  // Shortened YouTube URL with tracking parameters
  const ytShortUrl = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?si=testing123');
  assert.equal(ytShortUrl.valid, true, 'Shortened youtu.be URL must be valid');
  assert.equal(ytShortUrl.platform, 'youtube');
  assert.equal(ytShortUrl.videoId, 'dQw4w9WgXcQ');
  assert.equal(ytShortUrl.aspectRatio, '16:9');

  // YouTube Shorts URL
  const ytShorts = parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share');
  assert.equal(ytShorts.valid, true, 'YouTube Shorts URL must be valid');
  assert.equal(ytShorts.platform, 'youtube_shorts', 'Platform should be youtube_shorts');
  assert.equal(ytShorts.videoId, 'dQw4w9WgXcQ');
  assert.equal(ytShorts.aspectRatio, '9:16', 'Shorts must have 9:16 vertical aspect ratio');

  // Instagram Reels URL
  const instaReel = parseVideoUrl('https://www.instagram.com/reel/C3_abc123/?igsh=test1234');
  assert.equal(instaReel.valid, true, 'Instagram Reel URL must be valid');
  assert.equal(instaReel.platform, 'instagram_reels', 'Platform should be instagram_reels');
  assert.equal(instaReel.videoId, 'C3_abc123');
  assert.equal(instaReel.aspectRatio, '9:16', 'Instagram Reel must have 9:16 vertical aspect ratio');
  assert.ok(instaReel.embedUrl.includes('instagram.com/reel/C3_abc123/embed/'));

  // Invalid URL
  const invalid = parseVideoUrl('https://unsupported-site.com/video/999');
  assert.equal(invalid.valid, false, 'Unsupported URL should be marked invalid');
  assert.ok(invalid.error, 'Should provide informative error message');
});

test('14. Cloudflare D1 - Video Previews retrieval, platform filtering & aspect ratios', async () => {
  invalidateContentCache();
  const allVideos = await getVideoPreviews({ onlyPublished: false });
  assert.ok(Array.isArray(allVideos), 'getVideoPreviews must return an array');
  assert.ok(allVideos.length >= 3, 'Should return at least the 3 seeded sample videos');

  // Filter YouTube
  const youtubeOnly = await getVideoPreviews({ platform: 'youtube', onlyPublished: false });
  assert.ok(youtubeOnly.length > 0, 'Should find at least 1 standard YouTube video');
  assert.ok(youtubeOnly.every((v) => v.platform === 'youtube'), 'All items must be youtube platform');
  assert.ok(youtubeOnly.every((v) => v.aspect_ratio === '16:9'), 'Standard YouTube videos must be 16:9');

  // Filter YouTube Shorts
  const shortsOnly = await getVideoPreviews({ platform: 'youtube_shorts', onlyPublished: false });
  assert.ok(shortsOnly.length > 0, 'Should find at least 1 YouTube Shorts video');
  assert.ok(shortsOnly.every((v) => v.platform === 'youtube_shorts'), 'All items must be youtube_shorts platform');
  assert.ok(shortsOnly.every((v) => v.aspect_ratio === '9:16'), 'Shorts must be 9:16');

  // Filter Instagram Reels
  const reelsOnly = await getVideoPreviews({ platform: 'instagram_reels', onlyPublished: false });
  assert.ok(reelsOnly.length > 0, 'Should find at least 1 Instagram Reel preview');
  assert.ok(reelsOnly.every((v) => v.platform === 'instagram_reels'), 'All items must be instagram_reels platform');
  assert.ok(reelsOnly.every((v) => v.aspect_ratio === '9:16'), 'Reels must be 9:16');
});

test('15. Cloudflare D1 - Video Preview CRUD lifecycle (save, toggle, delete)', async () => {
  const testTitle = `Test Live Video Walkthrough - ${Date.now()}`;
  const testUrl = 'https://www.youtube.com/watch?v=ScMzIvxBSi4';

  // 1. Create draft video preview
  const created = await saveVideoPreview({
    title: testTitle,
    description: 'Testing video preview CRUD lifecycle in D1',
    video_url: testUrl,
    is_featured: false,
    is_published: false,
    sort_order: 999,
  });
  assert.ok(created.id > 0, 'Should return valid positive ID');

  // 2. Read back
  const readBack = await getVideoPreviewById(created.id);
  assert.ok(readBack, 'Created video preview must be queryable by ID');
  assert.equal(readBack.title, testTitle);
  assert.equal(readBack.platform, 'youtube');
  assert.equal(readBack.video_id, 'ScMzIvxBSi4');
  assert.equal(readBack.aspect_ratio, '16:9');
  assert.equal(readBack.is_published, false, 'Should initially be draft');

  // 3. Toggle publish status
  const toggled = await toggleVideoPreview(created.id);
  assert.equal(toggled, true, 'Toggled status should be true (published)');
  const readToggled = await getVideoPreviewById(created.id);
  assert.equal(readToggled?.is_published, true, 'Database row should reflect published');

  // 4. Delete video preview
  await deleteVideoPreview(created.id);
  const afterDelete = await getVideoPreviewById(created.id);
  assert.equal(afterDelete, null, 'Video preview should be deleted');
});

test('16. Skeleton Loaders & Progressive Media Contract Verification', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Verify skeletons.css
  const cssPath = path.resolve(process.cwd(), 'src/styles/skeletons.css');
  assert.ok(fs.existsSync(cssPath), 'src/styles/skeletons.css must exist');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssContent.includes('.skeleton-shimmer'), 'skeletons.css must have shimmer animation');
  assert.ok(cssContent.includes('.skeleton-pulse'), 'skeletons.css must have pulse animation');
  assert.ok(cssContent.includes('prefers-reduced-motion'), 'skeletons.css must support prefers-reduced-motion');
  assert.ok(cssContent.includes('.media-with-skeleton'), 'skeletons.css must support progressive media container');
  assert.ok(cssContent.includes('.is-loaded'), 'skeletons.css must handle .is-loaded state');
  assert.ok(cssContent.includes('.is-failed'), 'skeletons.css must handle .is-failed fallback state');

  // Verify Skeleton components exist
  const expectedComponents = [
    'src/components/skeletons/Skeleton.astro',
    'src/components/skeletons/SkeletonBanner.astro',
    'src/components/skeletons/SkeletonMandapCard.astro',
    'src/components/skeletons/SkeletonStageCard.astro',
    'src/components/skeletons/SkeletonEquipmentCard.astro',
    'src/components/skeletons/SkeletonCateringCard.astro',
    'src/components/skeletons/SkeletonGalleryItem.astro',
    'src/components/skeletons/SkeletonVideo.astro',
    'src/components/VideoPreviewCard.astro',
    'src/client/image-loader.ts',
  ];

  for (const comp of expectedComponents) {
    const fullPath = path.resolve(process.cwd(), comp);
    assert.ok(fs.existsSync(fullPath), `${comp} must exist`);
  }
});
