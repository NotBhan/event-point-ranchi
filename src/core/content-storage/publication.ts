/**
 * Publication coordination.
 *
 * Filebase holds immutable objects only. The single mutable fact — *which*
 * manifest is live — is a row in Neon, moved with compare-and-swap:
 *
 *   UPDATE content_pointers SET site_version = $new, …
 *    WHERE id = 'active' AND site_version = $expected
 *
 * Exactly one concurrent publisher can win; the loser gets a conflict and
 * leaves the active version untouched.
 *
 * This is deliberately not presented as a distributed transaction with
 * Filebase. A publication can fail after objects are uploaded (they stay as
 * inert orphans) or after the pointer moves (the release record is reconciled
 * against the pointer). See docs/content-publishing-recovery.md.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { getNeonClient } from '../operational/neon-client';
import { validatePublicationDocuments, type ContentDocument, type PageId } from './schema';
import { buildManifest, validateManifest, type ContentManifest } from './manifest';
import { getContentStore, manifestObjectKey, type ContentStore } from './store';

export const RELEASE_STATUSES = [
  'pending',
  'uploading',
  'verified',
  'published',
  'failed',
  'conflicted',
  'rolled_back',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export type PublicationErrorCode =
  | 'schema'
  | 'validation'
  | 'storage'
  | 'conflict'
  | 'not_found'
  | 'integrity';

export class PublicationError extends Error {
  readonly code: PublicationErrorCode;
  constructor(code: PublicationErrorCode, message: string) {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
  }
}

export interface ActivePointer {
  siteVersion: string;
  manifestKey: string;
  manifestSha256: string;
  publicationId: string;
  updatedAt: string | null;
  updatedBy: number | null;
}

export interface ReleaseRecord {
  id: string;
  siteVersion: string;
  status: ReleaseStatus;
  expectedVersion: string;
  manifestKey: string;
  manifestSha256: string;
  pages: Record<string, { version: number; object: string; sha256: string }>;
  publishedBy: number | null;
  publishedByName: string;
  error: string;
  createdAt: string | null;
  completedAt: string | null;
  rolledBackTo: string;
}

interface RawReleaseRow {
  id: string;
  site_version: string;
  status: string;
  expected_version: string;
  manifest_key: string;
  manifest_sha256: string;
  pages_json: string;
  published_by: number | null;
  published_by_name: string;
  error: string;
  created_at: string | null;
  completed_at: string | null;
  rolled_back_to: string;
}

function toRelease(row: RawReleaseRow): ReleaseRecord {
  let pages: ReleaseRecord['pages'] = {};
  try {
    pages = JSON.parse(row.pages_json || '{}');
  } catch {
    pages = {};
  }
  return {
    id: row.id,
    siteVersion: row.site_version,
    status: row.status as ReleaseStatus,
    expectedVersion: row.expected_version,
    manifestKey: row.manifest_key,
    manifestSha256: row.manifest_sha256,
    pages,
    publishedBy: row.published_by === null || row.published_by === undefined ? null : Number(row.published_by),
    publishedByName: row.published_by_name,
    error: row.error,
    createdAt: row.created_at ? String(row.created_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    rolledBackTo: row.rolled_back_to,
  };
}

const schemaVerified = new WeakSet<object>();

/**
 * Read-only check that migration 003 has run. Publishing must not create tables
 * on a live request.
 */
export async function assertContentSchema(): Promise<void> {
  const neon = getNeonClient();
  if (schemaVerified.has(neon)) return;
  try {
    await neon.query('SELECT 1 FROM content_pointers LIMIT 0');
    await neon.query('SELECT 1 FROM content_releases LIMIT 0');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PublicationError(
      'schema',
      `The operational database schema is out of date: content_pointers / content_releases are missing. ` +
        `Run \`npm run db:migrate:schema\`. (${detail})`,
    );
  }
  schemaVerified.add(neon);
}

export async function getActivePointer(): Promise<ActivePointer> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query<{
    site_version: string;
    manifest_key: string;
    manifest_sha256: string;
    publication_id: string;
    updated_at: string | null;
    updated_by: number | null;
  }>(
    'SELECT site_version, manifest_key, manifest_sha256, publication_id, updated_at, updated_by FROM content_pointers WHERE id = $1 LIMIT 1',
    ['active'],
  );

  const row = res.rows[0];
  if (!row) {
    throw new PublicationError('schema', 'The active content pointer row is missing. Run `npm run db:migrate:schema`.');
  }

  return {
    siteVersion: row.site_version ?? '',
    manifestKey: row.manifest_key ?? '',
    manifestSha256: row.manifest_sha256 ?? '',
    publicationId: row.publication_id ?? '',
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: row.updated_by === null || row.updated_by === undefined ? null : Number(row.updated_by),
  };
}

export async function listReleases(limit = 20): Promise<ReleaseRecord[]> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query<RawReleaseRow>(
    'SELECT * FROM content_releases ORDER BY created_at DESC, id DESC LIMIT $1',
    [Math.max(1, Math.min(100, limit))],
  );
  return res.rows.map(toRelease);
}

export async function getReleaseById(id: string): Promise<ReleaseRecord | null> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query<RawReleaseRow>('SELECT * FROM content_releases WHERE id = $1 LIMIT 1', [id]);
  return res.rows[0] ? toRelease(res.rows[0]) : null;
}

export async function getReleaseBySiteVersion(siteVersion: string): Promise<ReleaseRecord | null> {
  await assertContentSchema();
  const neon = getNeonClient();
  const res = await neon.query<RawReleaseRow>('SELECT * FROM content_releases WHERE site_version = $1 LIMIT 1', [
    siteVersion,
  ]);
  return res.rows[0] ? toRelease(res.rows[0]) : null;
}

/* ------------------------------------------------------------------ */
/* Release bookkeeping                                                 */
/* ------------------------------------------------------------------ */

async function insertRelease(record: {
  id: string;
  siteVersion: string;
  expectedVersion: string;
  publishedBy: number | null;
  publishedByName: string;
}): Promise<void> {
  const neon = getNeonClient();
  await neon.query(
    `INSERT INTO content_releases
       (id, site_version, status, expected_version, published_by, published_by_name, created_at, updated_at)
     VALUES ($1, $2, 'pending', $3, $4, $5, NOW(), NOW())`,
    [record.id, record.siteVersion, record.expectedVersion, record.publishedBy, record.publishedByName],
  );
}

async function updateRelease(
  id: string,
  fields: Partial<{
    status: ReleaseStatus;
    manifestKey: string;
    manifestSha256: string;
    pagesJson: string;
    error: string;
    rolledBackTo: string;
    complete: boolean;
  }>,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const push = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (fields.status !== undefined) push('status', fields.status);
  if (fields.manifestKey !== undefined) push('manifest_key', fields.manifestKey);
  if (fields.manifestSha256 !== undefined) push('manifest_sha256', fields.manifestSha256);
  if (fields.pagesJson !== undefined) push('pages_json', fields.pagesJson);
  if (fields.error !== undefined) push('error', fields.error);
  if (fields.rolledBackTo !== undefined) push('rolled_back_to', fields.rolledBackTo);

  sets.push('updated_at = NOW()');
  if (fields.complete) sets.push('completed_at = NOW()');
  if (sets.length === 1) return false;

  params.push(id);
  const neon = getNeonClient();
  const res = await neon.query(`UPDATE content_releases SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  return res.rowCount > 0;
}

/**
 * Compare-and-swap the active pointer. Returns false when another publisher has
 * moved the pointer since `expectedVersion` was read.
 */
async function swapPointer(input: {
  expectedVersion: string;
  siteVersion: string;
  manifestKey: string;
  manifestSha256: string;
  publicationId: string;
  updatedBy: number | null;
}): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    `UPDATE content_pointers
        SET site_version = $1, manifest_key = $2, manifest_sha256 = $3,
            publication_id = $4, updated_at = NOW(), updated_by = $5
      WHERE id = 'active' AND site_version = $6`,
    [
      input.siteVersion,
      input.manifestKey,
      input.manifestSha256,
      input.publicationId,
      input.updatedBy,
      input.expectedVersion,
    ],
  );
  return res.rowCount === 1;
}

/* ------------------------------------------------------------------ */
/* Publication                                                         */
/* ------------------------------------------------------------------ */

export function newSiteVersion(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export interface PublishInput {
  documents: unknown[];
  expectedVersion: string;
  actor: { id?: number | null; name: string };
  store?: ContentStore;
}

export interface StagedPublication {
  publicationId: string;
  siteVersion: string;
  manifestKey: string;
  manifestSha256: string;
  pages: Record<PageId, { version: number; object: string; sha256: string }>;
}

export type PublishResult = StagedPublication;

/**
 * Uploads and verifies a complete immutable publication **without** moving the
 * active pointer. The release is recorded as `verified`, which is what makes the
 * migration's apply step safe: nothing becomes visible until `activateRelease`.
 */
export async function stageContent(input: PublishInput): Promise<StagedPublication> {
  await assertContentSchema();

  let documents: ContentDocument[];
  try {
    documents = validatePublicationDocuments(input.documents);
  } catch (error) {
    throw new PublicationError('validation', error instanceof Error ? error.message : String(error));
  }

  const store = input.store ?? getContentStore();

  // Fail before uploading anything if the editor's view is already stale.
  const pointer = await getActivePointer();
  if (pointer.siteVersion !== input.expectedVersion) {
    throw new PublicationError(
      'conflict',
      `Content changed since you loaded it (active version is "${pointer.siteVersion || 'unpublished'}"). ` +
        'Reload the Content Studio and try again.',
    );
  }

  const publicationId = randomUUID();
  const siteVersion = newSiteVersion();

  await insertRelease({
    id: publicationId,
    siteVersion,
    expectedVersion: input.expectedVersion,
    publishedBy: input.actor.id ?? null,
    publishedByName: input.actor.name,
  });

  try {
    await updateRelease(publicationId, { status: 'uploading' });

    const pages: Array<{ pageId: PageId; version: number; sha256: string; object: string }> = [];
    for (const document of documents) {
      const stored = await store.putPage(document, siteVersion);
      pages.push({ pageId: document.pageId, version: document.contentVersion, sha256: stored.sha256, object: stored.key });
    }

    for (const page of pages) {
      const verification = await store.verifyObject(page.object, page.sha256);
      if (!verification.ok) {
        throw new PublicationError(
          'integrity',
          `Verification failed for ${page.object}: expected ${page.sha256}, got ${verification.actualSha256}`,
        );
      }
    }

    const manifest = buildManifest({
      siteVersion,
      publicationId,
      pages: pages.map((page) => ({ pageId: page.pageId, version: page.version, sha256: page.sha256 })),
    });
    const storedManifest = await store.putManifest(manifest, siteVersion);
    const manifestVerification = await store.verifyObject(storedManifest.key, storedManifest.sha256);
    if (!manifestVerification.ok) {
      throw new PublicationError('integrity', `Manifest verification failed for ${storedManifest.key}`);
    }

    const readBack = await store.readObject(storedManifest.key);
    if (!readBack) throw new PublicationError('integrity', `Manifest ${storedManifest.key} is missing after upload`);
    const parsed = validateManifest(JSON.parse(readBack.body), siteVersion);
    for (const pageId of Object.keys(parsed.pages) as PageId[]) {
      const entry = parsed.pages[pageId];
      const verification = await store.verifyObject(entry.object, entry.sha256);
      if (!verification.ok) {
        throw new PublicationError('integrity', `Object ${entry.object} does not match the manifest checksum`);
      }
    }

    await updateRelease(publicationId, {
      status: 'verified',
      manifestKey: storedManifest.key,
      manifestSha256: storedManifest.sha256,
      pagesJson: JSON.stringify(
        Object.fromEntries(pages.map((page) => [page.pageId, { version: page.version, object: page.object, sha256: page.sha256 }])),
      ),
    });

    return {
      publicationId,
      siteVersion,
      manifestKey: storedManifest.key,
      manifestSha256: storedManifest.sha256,
      pages: parsed.pages as StagedPublication['pages'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await updateRelease(publicationId, { status: 'failed', complete: true, error: message.slice(0, 1000) });
    } catch (bookkeepingError) {
      console.error('[content] publication failed AND its record could not be updated:', bookkeepingError);
    }
    if (error instanceof PublicationError) throw error;
    throw new PublicationError('storage', message);
  }
}

/**
 * Moves the active pointer to a previously staged release using compare-and-swap.
 * A concurrent publisher causes a `conflict` and leaves the active version alone.
 */
export async function activateRelease(input: {
  publicationId: string;
  expectedVersion: string;
  actor: { id?: number | null; name: string };
}): Promise<StagedPublication> {
  await assertContentSchema();

  const release = await getReleaseById(input.publicationId);
  if (!release) throw new PublicationError('not_found', `Release "${input.publicationId}" does not exist.`);
  if (release.status !== 'verified') {
    throw new PublicationError('validation', `Release "${release.id}" is "${release.status}", not "verified".`);
  }

  const swapped = await swapPointer({
    expectedVersion: input.expectedVersion,
    siteVersion: release.siteVersion,
    manifestKey: release.manifestKey,
    manifestSha256: release.manifestSha256,
    publicationId: release.id,
    updatedBy: input.actor.id ?? null,
  });

  if (!swapped) {
    await updateRelease(release.id, {
      status: 'conflicted',
      complete: true,
      error: 'Another publication changed the active content version before this one was activated.',
    });
    throw new PublicationError(
      'conflict',
      'Another publication completed first. The active content was not changed; reload and try again.',
    );
  }

  try {
    await updateRelease(release.id, { status: 'published', complete: true });
  } catch (error) {
    // The pointer moved, so the version IS live. Reconciliation repairs the record.
    console.error('[content] pointer moved but the release record could not be finalised:', error);
  }

  return {
    publicationId: release.id,
    siteVersion: release.siteVersion,
    manifestKey: release.manifestKey,
    manifestSha256: release.manifestSha256,
    pages: release.pages as StagedPublication['pages'],
  };
}

/** Stage + activate in one call — the normal Content Studio publish. */
export async function publishContent(input: PublishInput): Promise<StagedPublication> {
  const staged = await stageContent(input);
  return activateRelease({
    publicationId: staged.publicationId,
    expectedVersion: input.expectedVersion,
    actor: input.actor,
  });
}

/* ------------------------------------------------------------------ */
/* Rollback                                                            */
/* ------------------------------------------------------------------ */

export interface RollbackInput {
  targetSiteVersion: string;
  expectedVersion: string;
  actor: { id?: number | null; name: string; isAdmin: boolean };
  store?: ContentStore;
}

export async function rollbackContent(input: RollbackInput): Promise<{
  siteVersion: string;
  manifestKey: string;
  publicationId: string;
}> {
  await assertContentSchema();

  if (!input.actor.isAdmin) {
    throw new PublicationError('conflict', 'Only administrators may roll back published content.');
  }

  const store = input.store ?? getContentStore();
  const pointer = await getActivePointer();

  if (pointer.siteVersion !== input.expectedVersion) {
    throw new PublicationError(
      'conflict',
      `Content changed since you loaded it (active version is "${pointer.siteVersion || 'unpublished'}").`,
    );
  }

  const target = await getReleaseBySiteVersion(input.targetSiteVersion);
  if (!target || (target.status !== 'published' && target.status !== 'rolled_back')) {
    throw new PublicationError('not_found', `No published release found for version "${input.targetSiteVersion}".`);
  }
  if (!target.manifestKey || !target.manifestSha256) {
    throw new PublicationError('integrity', `Release "${target.siteVersion}" has no verified manifest.`);
  }

  // Verify every object the target manifest references before moving the pointer.
  const manifestObject = await store.readObject(target.manifestKey);
  if (!manifestObject) {
    throw new PublicationError('integrity', `Manifest ${target.manifestKey} is missing from storage.`);
  }
  if (manifestObject.sha256 !== target.manifestSha256) {
    throw new PublicationError('integrity', `Manifest ${target.manifestKey} does not match its recorded checksum.`);
  }

  const manifest: ContentManifest = validateManifest(JSON.parse(manifestObject.body), target.siteVersion);
  for (const pageId of Object.keys(manifest.pages) as PageId[]) {
    const entry = manifest.pages[pageId];
    const verification = await store.verifyObject(entry.object, entry.sha256);
    if (!verification.ok) {
      throw new PublicationError(
        'integrity',
        `Rollback aborted: ${entry.object} does not match its recorded checksum.`,
      );
    }
  }

  const swapped = await swapPointer({
    expectedVersion: input.expectedVersion,
    siteVersion: manifest.siteVersion,
    manifestKey: target.manifestKey,
    manifestSha256: target.manifestSha256,
    publicationId: target.id,
    updatedBy: input.actor.id ?? null,
  });

  if (!swapped) {
    throw new PublicationError(
      'conflict',
      'Another publication completed first. The active content was not changed.',
    );
  }

  // History entry for the rollback action itself (it does not own a content version).
  const recordId = randomUUID();
  const recordVersion = `rb-${newSiteVersion()}`;
  try {
    await insertRelease({
      id: recordId,
      siteVersion: recordVersion,
      expectedVersion: input.expectedVersion,
      publishedBy: input.actor.id ?? null,
      publishedByName: input.actor.name,
    });
    await updateRelease(recordId, {
      status: 'rolled_back',
      rolledBackTo: target.siteVersion,
      manifestKey: target.manifestKey,
      manifestSha256: target.manifestSha256,
      pagesJson: JSON.stringify(target.pages),
      complete: true,
    });
  } catch (error) {
    console.error('[content] rollback succeeded but its history entry could not be written:', error);
  }

  return { siteVersion: manifest.siteVersion, manifestKey: target.manifestKey, publicationId: target.id };
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

/**
 * Repairs release records whose final status write was lost: the pointer is the
 * authority, so a release whose site version is live is marked published, and a
 * verified release that never went live is marked failed.
 */
export async function reconcileReleases(): Promise<{ repaired: Array<{ id: string; status: ReleaseStatus }> }> {
  await assertContentSchema();
  const pointer = await getActivePointer();
  const neon = getNeonClient();
  const res = await neon.query<RawReleaseRow>(
    "SELECT * FROM content_releases WHERE status IN ('pending','uploading','verified') ORDER BY created_at ASC",
  );

  const repaired: Array<{ id: string; status: ReleaseStatus }> = [];
  for (const row of res.rows) {
    const release = toRelease(row);
    if (release.siteVersion === pointer.siteVersion) {
      await updateRelease(release.id, { status: 'published', complete: true });
      repaired.push({ id: release.id, status: 'published' });
    } else if (release.status === 'verified') {
      await updateRelease(release.id, {
        status: 'failed',
        complete: true,
        error: 'Publication never became active; the pointer still references another version.',
      });
      repaired.push({ id: release.id, status: 'failed' });
    }
  }
  return { repaired };
}

export { manifestObjectKey };
