/**
 * Immutable publication manifest.
 *
 * A manifest is a complete, self-contained description of one published site
 * version: which page object belongs to which page, at which version, with which
 * SHA-256. It is written once and never modified. The *authoritative* "which
 * manifest is live" answer lives in Neon (`content_pointers`), because Filebase
 * cannot enforce conditional writes.
 */
import {
  CONTENT_SCHEMA_VERSION,
  PAGE_IDS,
  PAGE_PATHS,
  type PageId,
} from './schema';
import { manifestObjectKey, pageObjectKey } from './store';

export interface ManifestPageEntry {
  version: number;
  object: string;
  sha256: string;
  path: string;
}

export interface ContentManifest {
  schemaVersion: number;
  siteVersion: string;
  publicationId: string;
  createdAt: string;
  pages: Record<PageId, ManifestPageEntry>;
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SITE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function buildManifest(input: {
  siteVersion: string;
  publicationId: string;
  createdAt?: string;
  pages: Array<{ pageId: PageId; version: number; sha256: string }>;
}): ContentManifest {
  const pages = {} as Record<PageId, ManifestPageEntry>;

  for (const entry of input.pages) {
    pages[entry.pageId] = {
      version: entry.version,
      object: pageObjectKey(entry.pageId, entry.version),
      sha256: entry.sha256,
      path: PAGE_PATHS[entry.pageId],
    };
  }

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    siteVersion: input.siteVersion,
    publicationId: input.publicationId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    pages,
  };
}

/** Validates a manifest read from storage before anything trusts it. */
export function validateManifest(raw: unknown, expectedSiteVersion?: string): ContentManifest {
  if (!raw || typeof raw !== 'object') throw new ManifestValidationError('manifest must be an object');
  const candidate = raw as Record<string, unknown>;

  if (Number(candidate.schemaVersion) !== CONTENT_SCHEMA_VERSION) {
    throw new ManifestValidationError(`manifest schemaVersion must be ${CONTENT_SCHEMA_VERSION}`);
  }
  if (typeof candidate.siteVersion !== 'string' || !SITE_VERSION_PATTERN.test(candidate.siteVersion)) {
    throw new ManifestValidationError('manifest siteVersion is invalid');
  }
  if (expectedSiteVersion && candidate.siteVersion !== expectedSiteVersion) {
    throw new ManifestValidationError(
      `manifest siteVersion "${candidate.siteVersion}" does not match the expected "${expectedSiteVersion}"`,
    );
  }
  if (typeof candidate.publicationId !== 'string' || candidate.publicationId.length === 0) {
    throw new ManifestValidationError('manifest publicationId is required');
  }
  if (typeof candidate.createdAt !== 'string' || Number.isNaN(Date.parse(candidate.createdAt))) {
    throw new ManifestValidationError('manifest createdAt must be an ISO timestamp');
  }

  const rawPages = candidate.pages;
  if (!rawPages || typeof rawPages !== 'object') throw new ManifestValidationError('manifest pages are missing');

  const pages = {} as Record<PageId, ManifestPageEntry>;
  for (const pageId of PAGE_IDS) {
    const entry = (rawPages as Record<string, unknown>)[pageId];
    if (!entry || typeof entry !== 'object') {
      throw new ManifestValidationError(`manifest is missing page "${pageId}"`);
    }
    const value = entry as Record<string, unknown>;
    const version = Number(value.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new ManifestValidationError(`manifest page "${pageId}" has an invalid version`);
    }
    if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
      throw new ManifestValidationError(`manifest page "${pageId}" has an invalid sha256`);
    }

    // The key must be exactly what this service would generate, so a tampered
    // manifest cannot point the reader at an arbitrary object.
    const expectedKey = pageObjectKey(pageId, version);
    if (value.object !== expectedKey) {
      throw new ManifestValidationError(
        `manifest page "${pageId}" points at "${String(value.object)}" instead of "${expectedKey}"`,
      );
    }
    if (value.path !== PAGE_PATHS[pageId]) {
      throw new ManifestValidationError(`manifest page "${pageId}" has an unexpected path`);
    }

    pages[pageId] = { version, object: expectedKey, sha256: value.sha256, path: PAGE_PATHS[pageId] };
  }

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    siteVersion: candidate.siteVersion,
    publicationId: candidate.publicationId,
    createdAt: candidate.createdAt,
    pages,
  };
}

/** Object key for a site version's manifest, re-exported for callers. */
export { manifestObjectKey };
