import type { PublicContentSnapshot, SnapshotManifest } from './snapshot-types';
import { SNAPSHOT_SCHEMA_VERSION } from './snapshot-types';
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
 * Detects the dev server. `import.meta.env.DEV` is not reliable here because an
 * ambient NODE_ENV=production turns it off inside `astro dev`, so the CLI
 * command is checked as well (same approach the prefetch config uses).
 */
export function isDevServer(): boolean {
  const viteEnv = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;
  if (viteEnv?.DEV === true || viteEnv?.MODE === 'development') return true;
  return process.argv.slice(0, 3).some((arg) => arg === 'dev');
}

export function formatSnapshotAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown age';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

/** One line per process so it is always clear which snapshot is being served. */
function logSnapshotInUse(bundle: SnapshotBundle): void {
  if (!bundle.manifest) return;
  const { contentVersion, generatedAt, counts } = bundle.manifest;
  const age = generatedAt ? formatSnapshotAge(Date.now() - Date.parse(generatedAt)) : 'unknown age';
  console.log(
    `[content-snapshot] serving v${contentVersion} (generated ${generatedAt ?? 'unknown'}, ${age}; ` +
      `${counts.mandaps} mandaps, ${counts.stages} stages, ${counts.galleryItems} gallery images, ` +
      `${counts.cateringPackages} catering packages)`,
  );
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
  const manifest = (rawManifest && typeof rawManifest === 'object' ? rawManifest : null) as SnapshotManifest | null;

  if (manifest && manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    const message =
      `[content-snapshot] Snapshot schema v${manifest.schemaVersion} is stale (this build needs v${SNAPSHOT_SCHEMA_VERSION}). ` +
      'Run `npm run sync:content` to regenerate it.';
    if (snapshotRequired()) throw new Error(message);
    console.warn(`${message} Falling back to live D1 reads.`);
    bundleScope.__eventPointSnapshot = null;
    return null;
  }

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

  bundleScope.__eventPointSnapshot = { snapshot, manifest };
  logSnapshotInUse(bundleScope.__eventPointSnapshot);
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
