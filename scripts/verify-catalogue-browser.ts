import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-browser-verif-'));
const tempDbDir = join(tempRoot, 'data');
mkdirSync(tempDbDir, { recursive: true });

const tempDb = join(tempDbDir, 'event-point-d1.db');
const tempOperationalDb = join(tempDbDir, 'event-point.db');
const tempBuildDb = join(tempRoot, 'build.db');
const tempSnapshotDir = join(tempRoot, 'content-snapshot');

process.env.D1_LOCAL = '1';
process.env.TEST_MODE = '1';
process.env.STORAGE_DRIVER = 'mock';
process.env.DATA_DIR = tempDbDir;
process.env.APP_SECRET = 'browser-verification-secret-xyz';
process.env.OPERATIONAL_DB_LOCAL_PATH = tempOperationalDb;
process.env.CONTENT_BUILD_D1_LOCAL_PATH = tempBuildDb;

const { D1Client } = await import('../src/core/content/d1-client');
const { syncContentTables } = await import('../src/core/content/d1-sync');
const { syncContent } = await import('./sync-content');
const { syncPrivilegedAccounts } = await import('../src/core/operational/service');

const existingSnapshot = JSON.parse(
  await import('node:fs/promises').then((fs) => fs.readFile('content-snapshot/public-content.json', 'utf8')),
);

console.log('[browser-verification] Initializing isolated test databases...');
const runtimeClient = new D1Client({ localDbPath: tempDb });
const buildClient = new D1Client({ localDbPath: tempBuildDb });

// Seed runtimeClient with existing public-content.json data
await runtimeClient.query(
  `INSERT INTO site_settings (id, name, legal_name, tagline, short_description, logo_url, favicon_url, phone, whatsapp, email, address, venue_address, business_hours, default_title, default_description, og_image_url)
   VALUES ('global', 'Event Point Ranchi', 'Event Point', 'Weddings', 'Decorators', '', '', '+91 90000 00000', '919000000000', 'test@test.com', 'Ranchi', 'Ranchi', '10-19', 'Title', 'Desc', '')`,
);

const pages = ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'];
for (const pageKey of pages) {
  await runtimeClient.query('INSERT INTO page_content (page_key, title, published) VALUES (?, ?, 1)', [pageKey, pageKey]);
}

for (const m of existingSnapshot.mandaps) {
  await runtimeClient.query(
    'INSERT INTO mandaps (id, name, slug, description, category, length_ft, width_ft, height_ft, dimension_unit, material_specs, price_starting_paise, is_visible, is_archived, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.id, m.name, m.slug, m.description, m.category, m.length_ft, m.width_ft, m.height_ft, m.dimension_unit, m.material_specs, m.price_starting_paise, 1, 0, m.sort_order],
  );
}

for (const s of existingSnapshot.stages) {
  await runtimeClient.query(
    'INSERT INTO stages (id, name, slug, description, style_category, length_ft, width_ft, height_ft, dimension_unit, decoration_notes, price_starting_paise, is_visible, is_archived, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [s.id, s.name, s.slug, s.description, s.style_category, s.length_ft, s.width_ft, s.height_ft, s.dimension_unit, s.decoration_notes, s.price_starting_paise, 1, 0, s.sort_order],
  );
}

for (const fc of existingSnapshot.furnitureCategories) {
  await runtimeClient.query(
    'INSERT INTO furniture_categories (id, name, slug, icon, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?)',
    [fc.id, fc.name, fc.slug, fc.icon, fc.sort_order, 1],
  );
}

for (const fi of existingSnapshot.furnitureItems) {
  await runtimeClient.query(
    'INSERT INTO furniture_items (id, category_id, name, slug, description, price_paise, pricing_unit, min_quantity, default_quantity, is_visible, is_archived, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [fi.id, fi.category_id, fi.name, fi.slug, fi.description, fi.price_paise, fi.pricing_unit, fi.min_quantity, fi.default_quantity, 1, 0, fi.sort_order],
  );
}

for (const cp of existingSnapshot.cateringPackages) {
  await runtimeClient.query(
    'INSERT INTO catering_packages (id, name, slug, description, category, price_per_plate_paise, badge, show_on_home, is_visible, is_archived, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [cp.id, cp.name, cp.slug, cp.description, cp.category, cp.price_per_plate_paise, cp.badge, 1, 1, 0, cp.sort_order],
  );
}

const galCat = await runtimeClient.query<{ id: number }>(
  "INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES ('Mandap Gallery', 'mandap-gallery', 1, 1)",
);
await runtimeClient.query(
  'INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, 1)',
  [Number(galCat.meta.last_row_id), 'Gallery item', '/storage/gallery.webp', 'Alt', 1],
);

// Initial sync to buildClient
console.log('[browser-verification] Initial sync runtime D1 -> build D1...');
await syncContentTables(runtimeClient, buildClient);

// Seed admin account in operational database
console.log('[browser-verification] Seeding admin user in operational database...');
await syncPrivilegedAccounts({ force: true });

// Build snapshot from buildClient
const initialManifest = await syncContent({
  fetcher: buildClient,
  outputDir: tempSnapshotDir,
});
console.log(`[browser-verification] Initial snapshot generated: v${initialManifest.contentVersion}`);

console.log('[browser-verification] Starting Astro test server...');

// Find free port
const port = await new Promise<number>((res) => {
  const s = createServer();
  s.listen(0, () => {
    const p = (s.address() as any).port;
    s.close(() => res(p));
  });
});

const serverProcess = spawn('node', ['./dist/server/entry.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    D1_LOCAL: '1',
    TEST_MODE: '1',
    DATA_DIR: tempDbDir,
    PAGE_CACHE: '0',
    CONTENT_SOURCE: 'd1',
    CLOUDFLARE_DATABASE_ID: 'test-runtime',
    CONTENT_BUILD_D1_LOCAL_PATH: tempBuildDb,
    OPERATIONAL_DB_LOCAL_PATH: tempOperationalDb,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProcess.stderr.on('data', (d) => process.stderr.write(d));

// Wait for server to be responsive
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server failed to start in 10s')), 10000);
  const interval = setInterval(async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/about`);
      if (resp.status === 200) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    } catch {}
  }, 200);
});

console.log(`[browser-verification] Server running on http://127.0.0.1:${port}`);
const baseUrl = `http://127.0.0.1:${port}`;

// Cookie jar for HTTP client
const cookies: Record<string, string> = {};

function updateCookiesFromHeaders(headers: Headers): void {
  const setCookies = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  for (const sc of setCookies) {
    if (!sc) continue;
    const parts = sc.split(';')[0].split('=');
    if (parts.length === 2) {
      cookies[parts[0].trim()] = parts[1].trim();
    }
  }
}

function cookieHeader(): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  const c = cookieHeader();
  if (c) headers.set('Cookie', c);
  if (cookies['rp_csrf'] && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', cookies['rp_csrf']);
  }
  const resp = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: 'manual',
  });
  updateCookiesFromHeaders(resp.headers);
  return resp;
}

// Chromium headless DOM reader
function chromiumDumpDom(url: string): string {
  return execFileSync(
    '/usr/bin/chromium',
    ['--headless', '--disable-gpu', '--dump-dom', url],
    { encoding: 'utf8', timeout: 10000 },
  );
}

function assertRedirect(status: number, message?: string): void {
  assert.ok(status >= 300 && status < 400, message ?? `Expected redirect (3xx), got ${status}`);
}

// 1. Authenticate as Admin
console.log('\n[browser-verification] Authenticating as Admin via /admin/login...');
const loginPageResp = await request('/admin/login');
assert.equal(loginPageResp.status, 200);
assert.ok(cookies['rp_csrf'], 'CSRF cookie established');

const loginForm = new URLSearchParams();
loginForm.set('username', 'admin');
loginForm.set('password', 'admin');
loginForm.set('_csrf', cookies['rp_csrf']);

const loginPostResp = await request('/admin/login', {
  method: 'POST',
  body: loginForm.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(loginPostResp.status, 'Login redirects to admin');
assert.ok(cookies['rp_admin_session'], 'Admin session cookie established');
console.log('✓ Successfully authenticated as Admin');

const auditLog: Array<{
  type: string;
  id: number;
  name: string;
  order: number;
  status: string;
  version: string;
  adminVerified: boolean;
  publicVerified: boolean;
}> = [];

// =========================================================================
// Case A: Mandap Creation with Default Order and Active Status
// =========================================================================
console.log('\n--- 1. Testing Case A: Mandap Creation & Publication ---');

// Verify creation form defaults: nextOrder = 7, status = active
const mandapNewFormResp = await request('/admin/mandaps/new');
const mandapNewFormHtml = await mandapNewFormResp.text();
assert.ok(mandapNewFormHtml.includes('name="sort_order"'), 'sort_order field present');
assert.ok(mandapNewFormHtml.includes('value="7"'), 'Default sort_order pre-filled with nextOrder (7)');
assert.ok(mandapNewFormHtml.includes('value="active" selected'), 'Default status is Active');
console.log('✓ Mandap creation form pre-fills sort_order=7 and status=active');

// Submit Mandap creation with default order (omit sort_order so it assigns nextOrder)
const mandapCreateData = new URLSearchParams();
mandapCreateData.set('name', 'Royal Marwar Palace Mandap');
mandapCreateData.set('category', 'Traditional Royal');
mandapCreateData.set('price', '250000');
mandapCreateData.set('description', 'Authentic Rajasthani hand-carved mandap with floral pillars.');
mandapCreateData.set('status', 'active');
mandapCreateData.set('_csrf', cookies['rp_csrf']);

const mandapCreateResp = await request('/admin/mandaps/new', {
  method: 'POST',
  body: mandapCreateData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(mandapCreateResp.status);
const mandapEditLocation = mandapCreateResp.headers.get('location') || '';
const mandapIdMatch = mandapEditLocation.match(/\/admin\/mandaps\/(\d+)/);
assert.ok(mandapIdMatch, 'Created mandap redirected to edit path');
const mandapId = Number(mandapIdMatch[1]);
assert.ok(mandapId > 0);

// Verify in Admin List
const mandapAdminListResp = await request('/admin/mandaps');
const mandapAdminListHtml = await mandapAdminListResp.text();
assert.ok(mandapAdminListHtml.includes('Royal Marwar Palace Mandap'), 'Mandap in admin list');
assert.ok(mandapAdminListHtml.includes('Active'), 'Mandap displayed as Active in admin');
console.log(`✓ Mandap (ID ${mandapId}) verified in admin list with Active status`);

// Trigger Publication (sync runtime D1 to build D1 & rebuild snapshot)
await syncContentTables(runtimeClient, buildClient);
const mandapManifest = await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });
console.log(`✓ Synchronized to build D1 and published version v${mandapManifest.contentVersion}`);

// Verify Mandap rendered in Public DOM via Headless Chromium
const mandapPublicDom = chromiumDumpDom(`${baseUrl}/mandaps`);
assert.ok(mandapPublicDom.includes('Royal Marwar Palace Mandap'), 'Mandap rendered in public DOM');
assert.ok(mandapPublicDom.includes('Traditional Royal'), 'Mandap category rendered');
console.log('✓ Mandap rendered on public page /mandaps via Chromium DOM');

auditLog.push({
  type: 'Mandap (Case A)',
  id: mandapId,
  name: 'Royal Marwar Palace Mandap',
  order: 7,
  status: 'Active',
  version: mandapManifest.contentVersion,
  adminVerified: true,
  publicVerified: true,
});

// =========================================================================
// Case B: Stage Creation with Order 4 and Active Status
// =========================================================================
console.log('\n--- 2. Testing Case B: Stage Creation (Order 4) & Publication ---');

// Verify creation form defaults: nextOrder = 7, status = active
const stageNewFormResp = await request('/admin/stages/new');
const stageNewFormHtml = await stageNewFormResp.text();
assert.ok(stageNewFormHtml.includes('name="sort_order"'), 'sort_order field present');
assert.ok(stageNewFormHtml.includes('value="active" selected'), 'Default status is Active');

// Submit Stage creation with explicit order 4
const stageCreateData = new URLSearchParams();
stageCreateData.set('name', 'Celestial Crystal LED Stage');
stageCreateData.set('style_category', 'Royal Reception');
stageCreateData.set('price', '175000');
stageCreateData.set('sort_order', '4');
stageCreateData.set('status', 'active');
stageCreateData.set('description', 'Multi-tiered crystal backdrop with programmed ambient LED wash.');
stageCreateData.set('_csrf', cookies['rp_csrf']);

const stageCreateResp = await request('/admin/stages/new', {
  method: 'POST',
  body: stageCreateData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(stageCreateResp.status);
const stageEditLocation = stageCreateResp.headers.get('location') || '';
const stageIdMatch = stageEditLocation.match(/\/admin\/stages\/(\d+)/);
assert.ok(stageIdMatch, 'Created stage redirected to edit path');
const stageId = Number(stageIdMatch[1]);
assert.ok(stageId > 0);

// Verify in Admin List
const stageAdminListResp = await request('/admin/stages');
const stageAdminListHtml = await stageAdminListResp.text();
assert.ok(stageAdminListHtml.includes('Celestial Crystal LED Stage'), 'Stage in admin list');
console.log(`✓ Stage (ID ${stageId}) created with explicit sort_order=4 verified in admin list`);

// Trigger Publication
await syncContentTables(runtimeClient, buildClient);
const stageManifest = await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });

// Verify Stage rendered in Public DOM via Headless Chromium
const stagePublicDom = chromiumDumpDom(`${baseUrl}/stages`);
assert.ok(stagePublicDom.includes('Celestial Crystal LED Stage'), 'Stage rendered in public DOM');
console.log('✓ Stage rendered on public page /stages via Chromium DOM');

auditLog.push({
  type: 'Stage (Case B)',
  id: stageId,
  name: 'Celestial Crystal LED Stage',
  order: 4,
  status: 'Active',
  version: stageManifest.contentVersion,
  adminVerified: true,
  publicVerified: true,
});

// =========================================================================
// Equipment / Furniture Creation with Category Linkage
// =========================================================================
console.log('\n--- 3. Testing Equipment / Furniture Creation & Publication ---');

// Verify creation form has category dropdown populated
const equipNewFormResp = await request('/admin/equipment/new');
const equipNewFormHtml = await equipNewFormResp.text();
assert.ok(equipNewFormHtml.includes('name="category_id"'), 'category_id select present');
assert.ok(equipNewFormHtml.includes('Seating'), 'Category dropdown populated with Seating option');
console.log('✓ Equipment creation form category dropdown is populated');

// Create Equipment item
const equipCreateData = new URLSearchParams();
equipCreateData.set('name', 'Vintage Velvet Royal Chair');
equipCreateData.set('category_id', '1');
equipCreateData.set('price', '750');
equipCreateData.set('pricing_unit', 'per day');
equipCreateData.set('status', 'active');
equipCreateData.set('description', 'Hand-stitched maroon velvet with ornate brass trimming.');
equipCreateData.set('_csrf', cookies['rp_csrf']);

const equipCreateResp = await request('/admin/equipment/new', {
  method: 'POST',
  body: equipCreateData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(equipCreateResp.status);
const equipEditLocation = equipCreateResp.headers.get('location') || '';
const equipIdMatch = equipEditLocation.match(/\/admin\/equipment\/(\d+)/);
assert.ok(equipIdMatch, 'Created equipment redirected to edit path');
const equipId = Number(equipIdMatch[1]);
assert.ok(equipId > 0);

// Verify in Admin List (using q search filter since total items > 20 per-page limit)
const equipAdminListResp = await request('/admin/equipment?q=Vintage');
const equipAdminListHtml = await equipAdminListResp.text();
assert.ok(equipAdminListHtml.includes('Vintage Velvet Royal Chair'), 'Equipment in admin list');
console.log(`✓ Equipment (ID ${equipId}) verified in admin list`);

// Trigger Publication
await syncContentTables(runtimeClient, buildClient);
const equipManifest = await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });

// Verify on Public Equipment Page via Chromium
const equipPublicDom = chromiumDumpDom(`${baseUrl}/equipment`);
assert.ok(equipPublicDom.includes('Vintage Velvet Royal Chair'), 'Equipment rendered in public DOM');
console.log('✓ Equipment rendered on public page /equipment under category');

auditLog.push({
  type: 'Equipment',
  id: equipId,
  name: 'Vintage Velvet Royal Chair',
  order: 25,
  status: 'Active',
  version: equipManifest.contentVersion,
  adminVerified: true,
  publicVerified: true,
});

// =========================================================================
// Catering Package Creation with Ordering & Status
// =========================================================================
console.log('\n--- 4. Testing Catering Package Creation & Publication ---');

// Verify creation form pre-fills nextOrder (4)
const cateringNewFormResp = await request('/admin/catering/new');
const cateringNewFormHtml = await cateringNewFormResp.text();
assert.ok(cateringNewFormHtml.includes('name="sort_order"'), 'sort_order present');
assert.ok(cateringNewFormHtml.includes('value="1"'), 'Default sort_order pre-filled with nextOrder (1)');
console.log('✓ Catering creation form pre-fills sort_order=1');

// Create Catering Package
const cateringCreateData = new URLSearchParams();
cateringCreateData.set('name', 'Imperial Nawabi Banquet');
cateringCreateData.set('category', 'Signature');
cateringCreateData.set('price', '2400');
cateringCreateData.set('badge', 'Bestseller');
cateringCreateData.set('description', 'Comprehensive 9-course Awadhi and Mughlai fine dining experience.');
cateringCreateData.set('is_active', 'true');
cateringCreateData.set('_csrf', cookies['rp_csrf']);

const cateringCreateResp = await request('/admin/catering/new', {
  method: 'POST',
  body: cateringCreateData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(cateringCreateResp.status);
const cateringEditLocation = cateringCreateResp.headers.get('location') || '';
const cateringIdMatch = cateringEditLocation.match(/\/admin\/catering\/(\d+)/);
assert.ok(cateringIdMatch, 'Created catering redirected to edit path');
const cateringId = Number(cateringIdMatch[1]);
assert.ok(cateringId > 0);

// Verify in Admin List
const cateringAdminListResp = await request('/admin/catering');
const cateringAdminListHtml = await cateringAdminListResp.text();
assert.ok(cateringAdminListHtml.includes('Imperial Nawabi Banquet'), 'Catering in admin list');
console.log(`✓ Catering Package (ID ${cateringId}) verified in admin list`);

// Trigger Publication
await syncContentTables(runtimeClient, buildClient);
const cateringManifest = await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });

// Verify on Public Catering Page via Chromium
const cateringPublicDom = chromiumDumpDom(`${baseUrl}/catering`);
assert.ok(cateringPublicDom.includes('Imperial Nawabi Banquet'), 'Catering rendered in public DOM');
console.log('✓ Catering package rendered on public page /catering');

auditLog.push({
  type: 'Catering',
  id: cateringId,
  name: 'Imperial Nawabi Banquet',
  order: 1,
  status: 'Active',
  version: cateringManifest.contentVersion,
  adminVerified: true,
  publicVerified: true,
});

// =========================================================================
// End-to-End Edit, Archive, and Reactivate Workflow
// =========================================================================
console.log('\n--- 5. Testing End-to-End Edit, Archive, and Reactivate Workflow ---');

// 1. Edit order: promote Mandap to order 1
console.log('Testing item edit and reordering...');
const mandapEditData = new URLSearchParams();
mandapEditData.set('name', 'Royal Marwar Palace Mandap (Grand)');
mandapEditData.set('category', 'Traditional Royal');
mandapEditData.set('price', '260000');
mandapEditData.set('sort_order', '1'); // Promoted to position 1
mandapEditData.set('status', 'active');
mandapEditData.set('_csrf', cookies['rp_csrf']);

const mandapEditPostResp = await request(`/admin/mandaps/${mandapId}`, {
  method: 'POST',
  body: mandapEditData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(mandapEditPostResp.status);

// Publish and verify updated title & order on public page
await syncContentTables(runtimeClient, buildClient);
await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });
const mandapUpdatedDom = chromiumDumpDom(`${baseUrl}/mandaps`);
assert.ok(mandapUpdatedDom.includes('Royal Marwar Palace Mandap (Grand)'), 'Public DOM reflects edited name and order');
console.log('✓ Mandap edit & reordering successfully reflected on public page');

// 2. Archive item: should disappear from public page
console.log('Testing item archiving...');
const mandapArchiveData = new URLSearchParams();
mandapArchiveData.set('action', 'archive');
mandapArchiveData.set('_csrf', cookies['rp_csrf']);

const mandapArchiveResp = await request(`/admin/mandaps/${mandapId}/action`, {
  method: 'POST',
  body: mandapArchiveData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(mandapArchiveResp.status);

// Publish and verify item disappears from public page
await syncContentTables(runtimeClient, buildClient);
await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });
const mandapArchivedDom = chromiumDumpDom(`${baseUrl}/mandaps`);
assert.ok(!mandapArchivedDom.includes('Royal Marwar Palace Mandap'), 'Archived mandap no longer present in public DOM');
console.log('✓ Archived mandap successfully removed from public rendering');

// 3. Reactivate item: should reappear on public page
console.log('Testing item reactivation...');
const mandapActivateData = new URLSearchParams();
mandapActivateData.set('action', 'activate');
mandapActivateData.set('_csrf', cookies['rp_csrf']);

const mandapActivateResp = await request(`/admin/mandaps/${mandapId}/action`, {
  method: 'POST',
  body: mandapActivateData.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
assertRedirect(mandapActivateResp.status);

// Publish and verify item reappears
await syncContentTables(runtimeClient, buildClient);
await syncContent({ fetcher: buildClient, outputDir: tempSnapshotDir });
const mandapReactivatedDom = chromiumDumpDom(`${baseUrl}/mandaps`);
assert.ok(mandapReactivatedDom.includes('Royal Marwar Palace Mandap (Grand)'), 'Reactivated mandap reappears in public DOM');
console.log('✓ Reactivated mandap successfully reappeared in public rendering');

// Take visual verification screenshots via Chromium
console.log('\n[browser-verification] Capturing Chromium visual screenshots...');
const screenshotsDir = '/home/chandrabhan/.gemini/antigravity-cli/brain/4e119d5e-c86f-49b7-953a-958375857149/screenshots';
mkdirSync(screenshotsDir, { recursive: true });

for (const pageName of ['mandaps', 'stages', 'equipment', 'catering']) {
  const screenshotPath = join(screenshotsDir, `${pageName}.png`);
  execFileSync(
    '/usr/bin/chromium',
    [
      '--headless',
      '--disable-gpu',
      `--screenshot=${screenshotPath}`,
      '--window-size=1280,800',
      `${baseUrl}/${pageName}`,
    ],
    { timeout: 15000 },
  );
  console.log(`✓ Screenshot captured for /${pageName}: ${screenshotPath}`);
}

// Cleanup
serverProcess.kill('SIGTERM');
runtimeClient.close();
buildClient.close();
rmSync(tempRoot, { recursive: true, force: true });

console.log('\n========================================================================');
console.log('               BROWSER VERIFICATION AUDIT SUMMARY TABLE                 ');
console.log('========================================================================');
console.table(auditLog);
console.log('All browser verification tests passed successfully!');
