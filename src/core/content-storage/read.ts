/**
 * Read path for published public content.
 *
 *   Neon pointer (short TTL) → immutable manifest in Filebase →
 *   immutable page object (cached forever per site version) → validated document
 *
 * Public requests never choose object keys: the page id selects the key, and the
 * manifest is validated against the exact key the store would generate.
 *
 * Failure handling is explicit:
 *   - the pointer is cached briefly and a stale pointer may be reused if Neon is
 *     briefly unreachable (it still names a real published version);
 *   - a page that fails validation or checksum raises an integrity error;
 *   - callers can fall back to the previous published version, or to D1 while
 *     the cutover flag is off.
 */
import {
  getActivePointer,
  listReleases,
  assertContentSchema,
  type ActivePointer,
} from './publication';
import { validateManifest, type ContentManifest } from './manifest';
import {
  PAGE_PATHS,
  isPageId,
  validateContentDocument,
  type ContentDocument,
  type PageId,
  type SiteDocument,
} from './schema';
import { getContentStore, type ContentStore } from './store';

export type ContentReadErrorCode = 'unpublished' | 'integrity' | 'unavailable';

export class ContentReadError extends Error {
  readonly code: ContentReadErrorCode;
  constructor(code: ContentReadErrorCode, message: string) {
    super(message);
    this.name = 'ContentReadError';
    this.code = code;
  }
}

/** Feature flag for the read cutover. Off means D1/snapshot remain authoritative. */
export function contentStoreEnabled(): boolean {
  const flag = (process.env.CONTENT_STORE ?? '').trim().toLowerCase();
  return flag === 'filebase' || flag === '1' || flag === 'true';
}

function pointerTtlMs(): number {
  const configured = Number(process.env.CONTENT_POINTER_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

const DOCUMENT_CACHE_MAX = 200;
const MANIFEST_CACHE_MAX = 20;

interface ContentReadState {
  pointer: ActivePointer | null;
  pointerAt: number;
  pointerInflight: Promise<ActivePointer> | null;
  documents: Map<string, ContentDocument>;
  manifests: Map<string, ContentManifest>;
}

export interface ContentFallbackCounters {
  record(event: { reason: string; pageId: string; fallback: string }): void;
  snapshot(): Record<string, number>;
  reset(): void;
}

interface ContentFallbackCountersScope {
  __eventPointContentFallbackCounters?: Record<string, number>;
}

/**
 * Process-wide fallback counters. Exposed so the Content Studio (and any future
 * metrics exporter) can surface "how often is the new source failing", which is
 * the signal a per-field D1 fallback would otherwise hide.
 */
export function getContentFallbackCounters(): ContentFallbackCounters {
  const scope = globalThis as typeof globalThis & ContentFallbackCountersScope;
  const counters = scope.__eventPointContentFallbackCounters ?? (scope.__eventPointContentFallbackCounters = {});

  const bump = (key: string) => {
    counters[key] = (counters[key] ?? 0) + 1;
  };

  return {
    record(event) {
      bump('total');
      bump(`reason.${event.reason}`);
      bump(`page.${event.pageId}`);
    },
    snapshot() {
      return { ...counters };
    },
    reset() {
      for (const key of Object.keys(counters)) delete counters[key];
    },
  };
}

interface ContentReadScope {
  __eventPointContentRead?: ContentReadState;
}

const scope = globalThis as typeof globalThis & ContentReadScope;

function state(): ContentReadState {
  if (!scope.__eventPointContentRead) {
    scope.__eventPointContentRead = {
      pointer: null,
      pointerAt: 0,
      pointerInflight: null,
      documents: new Map(),
      manifests: new Map(),
    };
  }
  return scope.__eventPointContentRead;
}

/** Test/deploy hook: drops every cached pointer, manifest and page document. */
export function resetContentReadCache(): void {
  const current = state();
  current.pointer = null;
  current.pointerAt = 0;
  current.pointerInflight = null;
  current.documents.clear();
  current.manifests.clear();
}

function rememberDocument(key: string, document: ContentDocument): void {
  const cache = state().documents;
  if (cache.size >= DOCUMENT_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, document);
}

function rememberManifest(siteVersion: string, manifest: ContentManifest): void {
  const cache = state().manifests;
  if (cache.size >= MANIFEST_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(siteVersion, manifest);
}

/**
 * Active pointer with a short TTL. If Neon is briefly unreachable the last
 * successfully read pointer is reused — it still names a real published version,
 * so this cannot expose unpublished content.
 */
export async function getPointer(): Promise<ActivePointer> {
  const current = state();
  const now = Date.now();

  if (current.pointer && now - current.pointerAt < pointerTtlMs()) {
    return current.pointer;
  }

  if (current.pointerInflight) return current.pointerInflight;

  const request = assertContentSchema()
    .then(() => getActivePointer())
    .then((pointer) => {
      current.pointer = pointer;
      current.pointerAt = Date.now();
      return pointer;
    })
    .catch((error) => {
      if (current.pointer) {
        console.error(
          '[content] could not refresh the active pointer; serving the last known published version ' +
            `"${current.pointer.siteVersion}":`,
          error instanceof Error ? error.message : error,
        );
        return current.pointer;
      }
      throw new ContentReadError(
        'unavailable',
        `The published content pointer could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      current.pointerInflight = null;
    });

  current.pointerInflight = request;
  return request;
}

export async function getPublishedSiteVersion(): Promise<string> {
  const pointer = await getPointer();
  return pointer.siteVersion;
}

async function loadManifest(reference: {
  siteVersion: string;
  manifestKey: string;
  manifestSha256: string;
}, store: ContentStore): Promise<ContentManifest> {
  const cached = state().manifests.get(reference.siteVersion);
  if (cached) return cached;

  const object = await store.readObject(reference.manifestKey);
  if (!object) {
    throw new ContentReadError('integrity', `Manifest ${reference.manifestKey} is missing.`);
  }
  if (object.sha256 !== reference.manifestSha256) {
    throw new ContentReadError(
      'integrity',
      `Manifest ${reference.manifestKey} does not match the checksum recorded for version "${reference.siteVersion}".`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(object.body);
  } catch {
    throw new ContentReadError('integrity', `Manifest ${reference.manifestKey} is not valid JSON.`);
  }

  const manifest = validateManifest(parsed, reference.siteVersion);
  rememberManifest(reference.siteVersion, manifest);
  return manifest;
}

export async function getPublishedManifest(store: ContentStore = getContentStore()): Promise<ContentManifest | null> {
  const pointer = await getPointer();
  if (!pointer.siteVersion || !pointer.manifestKey) return null;
  return loadManifest(pointer, store);
}

async function findPreviousPublishedReleases(currentVersion: string): Promise<Array<{
  siteVersion: string;
  manifestKey: string;
  manifestSha256: string;
}>> {
  try {
    const releases = await listReleases(20);
    return releases
      .filter(
        (release) =>
          release.status === 'published' &&
          release.siteVersion !== currentVersion &&
          release.manifestKey.length > 0 &&
          release.manifestSha256.length > 0,
      )
      .map((release) => ({
        siteVersion: release.siteVersion,
        manifestKey: release.manifestKey,
        manifestSha256: release.manifestSha256,
      }));
  } catch (error) {
    console.error('[content] could not list releases for fallback:', error instanceof Error ? error.message : error);
    return [];
  }
}

async function readDocumentFrom(
  manifest: ContentManifest,
  pageId: PageId,
  store: ContentStore,
): Promise<ContentDocument> {
  const cacheKey = `${manifest.siteVersion}:${pageId}`;
  const cached = state().documents.get(cacheKey);
  if (cached) return cached;

  const entry = manifest.pages[pageId];
  if (!entry) {
    throw new ContentReadError('integrity', `Manifest "${manifest.siteVersion}" does not contain page "${pageId}".`);
  }

  const object = await store.readObject(entry.object);
  if (!object) {
    throw new ContentReadError('integrity', `Page object ${entry.object} is missing.`);
  }
  if (object.sha256 !== entry.sha256) {
    throw new ContentReadError('integrity', `Page object ${entry.object} does not match its manifest checksum.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(object.body);
  } catch {
    throw new ContentReadError('integrity', `Page object ${entry.object} is not valid JSON.`);
  }

  const document = validateContentDocument(raw);
  if (document.pageId !== pageId) {
    throw new ContentReadError('integrity', `Page object ${entry.object} contains "${document.pageId}".`);
  }
  if (document.contentVersion !== entry.version) {
    throw new ContentReadError('integrity', `Page object ${entry.object} is version ${document.contentVersion}, expected ${entry.version}.`);
  }

  rememberDocument(cacheKey, document);
  return document;
}

/**
 * Returns a validated page document for the active version. On integrity failure
 * the previous published version is tried once, so a single corrupted object
 * cannot take the site down while an intact older version exists.
 */
export async function getPublishedPageDocument(
  pageId: PageId,
  options: { store?: ContentStore; allowFallback?: boolean } = {},
): Promise<ContentDocument> {
  if (!isPageId(pageId)) throw new ContentReadError('integrity', `Unknown page id "${String(pageId)}".`);

  const store = options.store ?? getContentStore();
  const pointer = await getPointer();
  if (!pointer.siteVersion) {
    throw new ContentReadError('unpublished', 'No content version has been published to object storage yet.');
  }

  try {
    const manifest = await loadManifest(pointer, store);
    return await readDocumentFrom(manifest, pageId, store);
  } catch (error) {
    if (options.allowFallback === false) throw error;

    const previous = await findPreviousPublishedReleases(pointer.siteVersion);
    for (const reference of previous.slice(0, 3)) {
      try {
        const manifest = await loadManifest(reference, store);
        const document = await readDocumentFrom(manifest, pageId, store);
        console.error(
          `[content] active version "${pointer.siteVersion}" failed for page "${pageId}"; ` +
            `serving last known good "${reference.siteVersion}".`,
          error instanceof Error ? error.message : error,
        );
        return document;
      } catch {
        // Try the next older version.
      }
    }

    throw error instanceof ContentReadError
      ? error
      : new ContentReadError('integrity', error instanceof Error ? error.message : String(error));
  }
}

export async function getPublishedSiteDocument(options: { store?: ContentStore } = {}): Promise<SiteDocument> {
  const document = await getPublishedPageDocument('site', options);
  if (document.pageId !== 'site') {
    throw new ContentReadError('integrity', 'The published "site" document has an unexpected page id.');
  }
  return document;
}

export async function getPublishedPageByPath(
  path: string,
  options: { store?: ContentStore; allowFallback?: boolean } = {},
): Promise<ContentDocument | null> {
  const normalised = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const pageId = (Object.keys(PAGE_PATHS) as PageId[]).find(
    (candidate) => candidate !== 'site' && PAGE_PATHS[candidate] === normalised,
  );
  if (!pageId) return null;
  return getPublishedPageDocument(pageId, options);
}
