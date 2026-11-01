/**
 * Immutable object storage for public content.
 *
 * Deliberately separate from `src/core/storage/` (media): different key space,
 * different rules, and no overwrite operation at all. It reuses the existing
 * S3-compatible transport so there is still one Filebase client and one set of
 * retry/error semantics.
 *
 * Invariants:
 *   - object keys are derived from approved page ids and integers only;
 *   - an existing key is never overwritten;
 *   - every upload is read back and SHA-256 verified before it can be published.
 */
import { createHash } from 'node:crypto';
import { getFilebaseClient, type FilebaseClient } from '../storage/filebase';
import { isPageId, type ContentDocument, type PageId } from './schema';

export class ContentStorageError extends Error {
  readonly key?: string;
  constructor(message: string, key?: string) {
    super(message);
    this.name = 'ContentStorageError';
    this.key = key;
  }
}

const DEFAULT_PREFIX = 'site-content/';
const OPERATION_TIMEOUT_MS = 10_000;
const KEY_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SITE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Root prefix for content objects. `CONTENT_PREFIX` exists so migrations and
 * parity runs can use a non-production namespace; it is validated so a stray
 * value cannot escape into arbitrary keys.
 */
export function contentPrefix(): string {
  const configured = process.env.CONTENT_PREFIX?.trim();
  if (!configured) return DEFAULT_PREFIX;
  if (!KEY_PATTERN.test(configured) || configured.includes('..') || configured.startsWith('/')) {
    throw new ContentStorageError(`CONTENT_PREFIX is not a safe object prefix: "${configured}"`);
  }
  return configured.endsWith('/') ? configured : `${configured}/`;
}

export function pageObjectKey(pageId: PageId, contentVersion: number): string {
  if (!isPageId(pageId)) throw new ContentStorageError(`Unknown page id: ${String(pageId)}`);
  if (!Number.isInteger(contentVersion) || contentVersion < 1 || contentVersion > 999_999) {
    throw new ContentStorageError(`Invalid content version: ${String(contentVersion)}`);
  }
  return `${contentPrefix()}pages/${pageId}/v${String(contentVersion).padStart(6, '0')}.json`;
}

export function manifestObjectKey(siteVersion: string): string {
  if (!SITE_VERSION_PATTERN.test(siteVersion)) {
    throw new ContentStorageError(`Invalid site version: "${siteVersion}"`);
  }
  return `${contentPrefix()}manifests/${siteVersion}.json`;
}

/** Rejects any key this service did not generate. */
export function assertContentKey(key: string): string {
  const prefix = contentPrefix();
  if (typeof key !== 'string' || !key.startsWith(prefix) || !KEY_PATTERN.test(key) || key.includes('..')) {
    throw new ContentStorageError(`Refusing to access a key outside the content namespace: "${key}"`, key);
  }
  return key;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ContentStorageError(`${label} timed out after ${OPERATION_TIMEOUT_MS}ms`));
    }, OPERATION_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function toBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'utf8'));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface StoredContentObject {
  key: string;
  sha256: string;
  size: number;
  etag: string;
}

export interface ReadContentObject {
  key: string;
  body: string;
  sha256: string;
  size: number;
  etag: string;
}

export interface ContentStore {
  putPage(document: ContentDocument, siteVersion: string): Promise<StoredContentObject>;
  putManifest(manifest: unknown, siteVersion: string): Promise<StoredContentObject>;
  readObject(key: string): Promise<ReadContentObject | null>;
  headObject(key: string): Promise<{ key: string; size: number; etag: string; contentType?: string } | null>;
  verifyObject(key: string, expectedSha256: string): Promise<{ ok: boolean; actualSha256: string; size: number }>;
}

export function createContentStore(client: FilebaseClient = getFilebaseClient()): ContentStore {
  /**
   * Writes an object that must never change. If the key already holds the same
   * bytes the write is skipped (idempotent re-runs); if it holds anything else
   * the operation fails rather than overwriting a published version.
   */
  async function putImmutable(
    key: string,
    body: string,
    metadata: Record<string, string>,
  ): Promise<StoredContentObject> {
    assertContentKey(key);
    const bytes = toBytes(body);
    const sha256 = sha256Hex(bytes);

    const existing = await withTimeout(client.headObject(key), `HEAD ${key}`);
    if (existing) {
      if (existing.size !== bytes.byteLength) {
        throw new ContentStorageError(
          `Refusing to overwrite ${key}: it already exists with a different size (${existing.size} bytes)`,
          key,
        );
      }
      const current = await withTimeout(client.getObject(key), `GET ${key}`);
      if (!current || sha256Hex(current.body) !== sha256) {
        throw new ContentStorageError(
          `Refusing to overwrite ${key}: an immutable object already exists. ` +
            'Changed content needs a new version (for the exporter: --version N).',
          key,
        );
      }
      return { key, sha256, size: bytes.byteLength, etag: existing.etag };
    }

    const result = await withTimeout(
      client.putObject({
        key,
        body: bytes,
        contentType: 'application/json; charset=utf-8',
        metadata: { sha256, ...metadata },
      }),
      `PUT ${key}`,
    );

    return { key, sha256, size: bytes.byteLength, etag: result.etag };
  }

  return {
    async putPage(document, siteVersion) {
      const key = pageObjectKey(document.pageId, document.contentVersion);
      return putImmutable(key, stableJson(document), {
        pageid: document.pageId,
        contentversion: String(document.contentVersion),
        siteversion: siteVersion,
        sha256: sha256Hex(stableJson(document)),
      });
    },

    async putManifest(manifest, siteVersion) {
      const key = manifestObjectKey(siteVersion);
      const body = stableJson(manifest);
      return putImmutable(key, body, { siteversion: siteVersion, kind: 'manifest' });
    },

    async readObject(key) {
      assertContentKey(key);
      const object = await withTimeout(client.getObject(key), `GET ${key}`);
      if (!object) return null;
      const bytes = object.body;
      return {
        key,
        body: Buffer.from(bytes).toString('utf8'),
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
        etag: object.etag,
      };
    },

    async headObject(key) {
      assertContentKey(key);
      const head = await withTimeout(client.headObject(key), `HEAD ${key}`);
      if (!head) return null;
      return { key, size: head.size, etag: head.etag, contentType: head.contentType };
    },

    async verifyObject(key, expectedSha256) {
      const object = await this.readObject(key);
      if (!object) {
        throw new ContentStorageError(`Verification failed: ${key} is missing`, key);
      }
      return { ok: object.sha256 === expectedSha256, actualSha256: object.sha256, size: object.size };
    },
  };
}

let cachedStore: ContentStore | null = null;

export function getContentStore(): ContentStore {
  if (!cachedStore) cachedStore = createContentStore();
  return cachedStore;
}

/** Test hook: drops the memoised store so a new prefix/client takes effect. */
export function resetContentStore(): void {
  cachedStore = null;
}
