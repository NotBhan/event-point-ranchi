import type { PublicContentSnapshot, SnapshotManifest } from './snapshot-types';
import { validateSnapshotData } from './snapshot-builder';

interface SnapshotBundle {
  snapshot: PublicContentSnapshot;
  manifest: SnapshotManifest | null;
}

interface SnapshotGlobalScope {
  __eventPointSnapshot?: SnapshotBundle | null;
}

const bundleScope = globalThis as typeof globalThis & SnapshotGlobalScope;

// Vite inlines these JSON files into the server bundle at build time, so the
// production function never depends on files present on disk at runtime. The
// glob resolves to an empty map when `npm run sync:content` has not run
// (local dev), in which case services fall back to live D1 reads.
//
// The try/catch matters: outside Vite (unit tests, plain Node scripts)
// `import.meta.glob` does not exist and the call throws, so the snapshot is
// reported as unavailable instead of crashing the module.
function loadBundledFiles(): Record<string, unknown> {
  try {
    return import.meta.glob('/content-snapshot/*.json', {
      eager: true,
      import: 'default',
    }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const bundledFiles = loadBundledFiles();

function readEnv(name: string): string | undefined {
  const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function snapshotRequired(): boolean {
  return readEnv('REQUIRE_SNAPSHOT') === '1';
}

export function contentSourceMode(): 'auto' | 'snapshot' | 'd1' {
  const value = readEnv('CONTENT_SOURCE');
  if (value === 'snapshot' || value === 'd1') return value;
  return 'auto';
}

/**
 * `astro dev` keeps using live D1 so CMS edits show up immediately while
 * developing. Production builds (and `astro preview`) use the snapshot.
 * `CONTENT_SOURCE=snapshot` overrides this for local snapshot testing.
 */
function isDevServer(): boolean {
  const viteEnv = (import.meta as { env?: { DEV?: boolean } }).env;
  return Boolean(viteEnv?.DEV);
}

function loadBundle(): SnapshotBundle | null {
  if (bundleScope.__eventPointSnapshot !== undefined) return bundleScope.__eventPointSnapshot;

  const rawSnapshot = bundledFiles['/content-snapshot/public-content.json'];
  const rawManifest = bundledFiles['/content-snapshot/manifest.json'];

  if (!rawSnapshot || typeof rawSnapshot !== 'object') {
    if (snapshotRequired()) {
      throw new Error(
        '[content-snapshot] REQUIRE_SNAPSHOT=1 but no snapshot was bundled. Run `npm run sync:content` before building.',
      );
    }
    bundleScope.__eventPointSnapshot = null;
    return null;
  }

  const snapshot = rawSnapshot as PublicContentSnapshot;
  try {
    validateSnapshotData(snapshot);
  } catch (error) {
    if (snapshotRequired()) throw error;
    console.warn(
      '[content-snapshot] Snapshot failed validation; falling back to live D1 reads.',
      error instanceof Error ? error.message : error,
    );
    bundleScope.__eventPointSnapshot = null;
    return null;
  }

  const manifest = (rawManifest && typeof rawManifest === 'object' ? rawManifest : null) as SnapshotManifest | null;
  bundleScope.__eventPointSnapshot = { snapshot, manifest };
  return bundleScope.__eventPointSnapshot;
}

/**
 * Returns the bundled public content snapshot, or null when the build has no
 * snapshot (local development) or when CONTENT_SOURCE=d1 is set.
 */
export function getSnapshot(): PublicContentSnapshot | null {
  const mode = contentSourceMode();
  if (mode === 'd1') return null;
  if (mode === 'auto' && isDevServer()) return null;
  return loadBundle()?.snapshot ?? null;
}

export function getSnapshotManifest(): SnapshotManifest | null {
  const mode = contentSourceMode();
  if (mode === 'd1') return null;
  if (mode === 'auto' && isDevServer()) return null;
  return loadBundle()?.manifest ?? null;
}

export function resetSnapshotCache(): void {
  bundleScope.__eventPointSnapshot = undefined;
}
