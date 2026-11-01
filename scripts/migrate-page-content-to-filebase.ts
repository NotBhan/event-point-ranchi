/**
 * Exports the simple public page content from Cloudflare D1 into immutable
 * Filebase objects, and (separately) activates it.
 *
 *   npm run content:export                 # dry run: read, validate, report, write nothing
 *   npm run content:export -- --apply      # upload immutable objects + manifest (pointer unchanged)
 *   npm run content:export -- --activate   # move the active pointer to the latest verified release
 *
 * Guarantees:
 *   - D1 is only ever read; this script contains no writes to D1;
 *   - apply does not change the active pointer (activation is a separate step);
 *   - re-running is safe: identical bytes reuse the existing immutable object;
 *   - catalogue tables are never read or migrated.
 */
import { getD1Client } from '../src/core/content/d1-client';
import { SITE_PAGE_IDS } from '../src/core/content-storage/mapping';
import { buildDocumentsFromD1 } from '../src/core/content-storage/export';
import { validatePublicationDocuments, type ContentDocument } from '../src/core/content-storage/schema';
import {
  activateRelease,
  getActivePointer,
  listReleases,
  stageContent,
  type StagedPublication,
} from '../src/core/content-storage/publication';

interface Options {
  apply: boolean;
  activate: boolean;
  contentVersion: number;
  updatedBy: string;
  allowCanonicalDrift: boolean;
  updatedAt?: string;
}

function parseArgs(argv: string[]): Options {
  const versionIndex = argv.indexOf('--version');
  const updatedByIndex = argv.indexOf('--updated-by');
  const updatedAtIndex = argv.indexOf('--updated-at');
  return {
    apply: argv.includes('--apply'),
    activate: argv.includes('--activate'),
    contentVersion: versionIndex >= 0 ? Number(argv[versionIndex + 1]) : 1,
    updatedBy: updatedByIndex >= 0 ? argv[updatedByIndex + 1] : 'content-migration',
    allowCanonicalDrift: argv.includes('--allow-canonical-drift'),
    updatedAt: updatedAtIndex >= 0 ? argv[updatedAtIndex + 1] : undefined,
  };
}

interface Finding {
  table: string;
  record: string;
  field: string;
  value: string;
  reason: string;
}

const MAPPED_PAGE_COLUMNS = new Set([
  'id',
  'page_key',
  'title',
  'subtitle',
  'description',
  'banner_image_url',
  'banner_enabled',
  'content_json',
  'seo_title',
  'seo_description',
  'og_image_url',
  'published',
  'created_at',
  'updated_at',
]);

const MAPPED_SETTINGS_COLUMNS = new Set([
  'id',
  'name',
  'legal_name',
  'tagline',
  'short_description',
  'logo_url',
  'favicon_url',
  'phone',
  'whatsapp',
  'email',
  'address',
  'venue_address',
  'business_hours',
  'social_links_json',
  'primary_color',
  'gold_bright',
  'font_preset',
  'default_title',
  'default_description',
  'og_image_url',
  'currency',
  'locale',
  'announcement_enabled',
  'announcement_text',
  'announcement_location',
  'announcement_phone',
  'google_maps_url',
  'latitude',
  'longitude',
  'footer_text',
  'contact_buttons_enabled',
  'maintenance_enabled',
  'maintenance_message',
  'created_at',
  'updated_at',
]);

/**
 * Looks for data the document schema cannot represent. Nothing is dropped
 * silently: anything found is reported and, for canonical drift, blocks the run.
 */
async function collectUnmapped(options: Options): Promise<Finding[]> {
  const findings: Finding[] = [];
  const d1 = getD1Client();

  const pageRows = await d1.query<Record<string, unknown>>('SELECT * FROM page_content ORDER BY page_key');
  for (const row of pageRows.results) {
    for (const [column, value] of Object.entries(row)) {
      if (MAPPED_PAGE_COLUMNS.has(column)) continue;
      if (value === null || value === '' || value === 0) continue;
      findings.push({
        table: 'page_content',
        record: String(row.page_key),
        field: column,
        value: String(value).slice(0, 120),
        reason: 'column has no equivalent in the page document schema',
      });
    }
  }

  const seoRows = await d1.query<Record<string, unknown>>('SELECT * FROM seo_settings ORDER BY page_key');
  for (const row of seoRows.results) {
    const canonical = String(row.canonical_url ?? '');
    const pageKey = String(row.page_key);
    if (!canonical) continue;

    const expected = pageKey === 'home' ? '/' : `/${pageKey}`;
    let resolved = canonical;
    try {
      resolved = new URL(canonical).pathname;
    } catch {
      resolved = canonical;
    }
    if (resolved.length > 1) resolved = resolved.replace(/\/+$/, '');

    if (resolved !== expected) {
      findings.push({
        table: 'seo_settings',
        record: pageKey,
        field: 'canonical_url',
        value: canonical,
        reason: `canonical resolves to "${resolved}" but the page route is "${expected}"`,
      });
    }
  }

  const settingsRows = await d1.query<Record<string, unknown>>('SELECT * FROM site_settings LIMIT 1');
  const settings = settingsRows.results[0] ?? {};
  for (const [column, value] of Object.entries(settings)) {
    if (MAPPED_SETTINGS_COLUMNS.has(column)) continue;
    if (value === null || value === '') continue;
    findings.push({
      table: 'site_settings',
      record: 'global',
      field: column,
      value: String(value).slice(0, 120),
      reason: 'column has no equivalent in the site document schema',
    });
  }

  const blocking = findings.filter((finding) => finding.table === 'seo_settings' && !options.allowCanonicalDrift);
  findings.forEach((finding) => {
    const blockingFlag = finding.table === 'seo_settings' && !options.allowCanonicalDrift ? ' [BLOCKS]' : '';
    console.log(
      `  ${finding.table}.${finding.field} (${finding.record}) = ${JSON.stringify(finding.value)} — ${finding.reason}${blockingFlag}`,
    );
  });
  return blocking;
}


async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log(`Mode            : ${options.activate ? 'activate' : options.apply ? 'apply (stage only)' : 'dry run'}`);
  console.log(`Content version : ${options.contentVersion}`);
  console.log(`Updated by      : ${options.updatedBy}`);
  console.log(`Object prefix   : ${process.env.CONTENT_PREFIX || 'site-content/'}\n`);

  const pointer = await getActivePointer();
  console.log(`Active version  : ${pointer.siteVersion || '(nothing published from object storage)'}\n`);

  if (options.activate) {
    const releases = await listReleases(20);
    const candidate = releases.find((release) => release.status === 'verified');
    if (!candidate) {
      throw new Error('No verified release is waiting to be activated. Run with --apply first.');
    }
    console.log(`Activating      : ${candidate.id} (${candidate.siteVersion})`);
    const result = await activateRelease({
      publicationId: candidate.id,
      expectedVersion: pointer.siteVersion,
      actor: { id: null, name: options.updatedBy },
    });
    console.log(`\nActivated ${result.siteVersion}`);
    console.log(`Manifest  ${result.manifestKey}`);
    return;
  }

  // ---- read D1 (read-only) ------------------------------------------------
  const pageRows = await getD1Client().query<Record<string, unknown>>('SELECT * FROM page_content');
  const seoRows = await getD1Client().query<Record<string, unknown>>('SELECT * FROM seo_settings');
  const settingsRows = await getD1Client().query<Record<string, unknown>>('SELECT * FROM site_settings LIMIT 1');
  const homepageRows = await getD1Client().query<Record<string, unknown>>('SELECT * FROM homepage_sections');
  const serviceRows = await getD1Client().query<Record<string, unknown>>('SELECT * FROM services');

  console.log('D1 inventory');
  console.log(`  page_content rows      : ${pageRows.results.length} (${SITE_PAGE_IDS.length} rendered: ${SITE_PAGE_IDS.join(', ')})`);
  console.log(`  seo_settings rows      : ${seoRows.results.length}`);
  console.log(`  site_settings rows     : ${settingsRows.results.length}`);
  console.log(`  homepage_sections rows : ${homepageRows.results.length}`);
  console.log(`  services rows          : ${serviceRows.results.length}\n`);

  console.log('Unmapped fields');
  const blocking = await collectUnmapped(options);
  if (blocking.length > 0) {
    throw new Error(
      `${blocking.length} field(s) require a decision before migrating (see [BLOCKS] above). ` +
        'Re-run with --allow-canonical-drift only if the route-derived canonical is acceptable.',
    );
  }
  console.log('  (none)\n');

  // ---- build + validate ---------------------------------------------------
  const { documents } = await buildDocumentsFromD1({
    updatedBy: options.updatedBy,
    contentVersion: options.contentVersion,
    updatedAt: options.updatedAt,
  });

  const validated = validatePublicationDocuments(documents);
  console.log(`Validated ${validated.length} documents:`);
  for (const document of validated) {
    const detail =
      document.pageId === 'site'
        ? `${document.services.length} services, ${document.homepageSections.length} homepage sections`
        : `${document.sections.length} sections, canonical ${document.seo.canonicalUrl}`;
    console.log(`  ${document.pageId.padEnd(10)} v${document.contentVersion} ${document.path.padEnd(11)} ${detail}`);
  }
  console.log('');

  if (!options.apply) {
    console.log('Dry run — nothing uploaded, the active pointer was not touched.');
    console.log('Re-run with --apply to upload immutable objects, then --activate to publish.');
    return;
  }

  const actor = { id: null, name: options.updatedBy };
  // Staging must not move the pointer; activation is always a separate step.
  const result: StagedPublication = await stageContent({ documents: validated, expectedVersion: pointer.siteVersion, actor });

  console.log(`\nStaged release ${result.publicationId}`);
  console.log(`  site version : ${result.siteVersion}`);
  console.log(`  manifest     : ${result.manifestKey}`);
  console.log(`  sha256       : ${result.manifestSha256}`);
  console.log('\nThe active pointer was NOT changed. Run with --activate to publish this version.');
}

main().catch((error) => {
  console.error('\nMigration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
