import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { D1Client } from '../src/core/content/d1-client';
import {
  buildManifest,
  buildSnapshot,
  fetchPublicContentRows,
  validateSnapshotData,
  type SnapshotRowFetcher,
} from '../src/core/content/snapshot-builder';
import type { PublicContentSnapshot, SnapshotManifest } from '../src/core/content/snapshot-types';

const REQUIRED_ENV = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_DATABASE_ID',
  'CLOUDFLARE_API_TOKEN',
] as const;

export interface SyncConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  outputDir: string;
  timeoutMs: number;
}

export interface SyncConfigResult {
  config: SyncConfig | null;
  missing: string[];
}

/**
 * Resolves the D1 credentials used by `npm run sync:content`. Pure so the
 * missing-credential path is covered by tests without touching the network.
 */
export function resolveSyncConfig(
  env: Record<string, string | undefined> = process.env,
): SyncConfigResult {
  const missing = REQUIRED_ENV.filter((key) => !(env[key] ?? '').trim());
  if (missing.length > 0) return { config: null, missing };

  return {
    config: {
      accountId: env.CLOUDFLARE_ACCOUNT_ID!.trim(),
      databaseId: env.CLOUDFLARE_DATABASE_ID!.trim(),
      apiToken: env.CLOUDFLARE_API_TOKEN!.trim(),
      outputDir: resolve(process.cwd(), env.CONTENT_SNAPSHOT_DIR || 'content-snapshot'),
      timeoutMs: Number(env.CONTENT_SYNC_TIMEOUT_MS || 20000),
    },
    missing: [],
  };
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

export interface SyncContentOptions {
  fetcher: SnapshotRowFetcher;
  outputDir: string;
  generatedAt?: string;
  log?: (message: string) => void;
}

/**
 * Fetches (one batched D1 request), validates and persists the public content
 * snapshot. Nothing is written unless validation passes, so a failed sync can
 * never replace a previously good snapshot.
 */
export async function syncContent(options: SyncContentOptions): Promise<SnapshotManifest> {
  const log = options.log ?? (() => {});

  const rows = await fetchPublicContentRows(options.fetcher);
  const snapshot: PublicContentSnapshot = buildSnapshot(rows);
  validateSnapshotData(snapshot);
  const manifest = buildManifest(snapshot, options.generatedAt);

  mkdirSync(options.outputDir, { recursive: true });
  writeJsonAtomic(join(options.outputDir, 'public-content.json'), snapshot);
  writeJsonAtomic(join(options.outputDir, 'manifest.json'), manifest);

  log(`[sync:content] wrote v${manifest.contentVersion} to ${options.outputDir}`);
  return manifest;
}

async function main(): Promise<void> {
  const { config, missing } = resolveSyncConfig();
  if (!config) {
    console.error(
      `[sync:content] Missing Cloudflare D1 credentials: ${missing.join(', ')}. ` +
        'Set them in the environment (never commit them).',
    );
    process.exitCode = 1;
    return;
  }

  const client = new D1Client({
    accountId: config.accountId,
    databaseId: config.databaseId,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
  });

  const manifest = await syncContent({ fetcher: client, outputDir: config.outputDir, log: console.log });
  const counts = manifest.counts;
  console.log(
    `[sync:content] v${manifest.contentVersion} · mandaps=${counts.mandaps} stages=${counts.stages} ` +
      `equipment=${counts.furnitureItems} packages=${counts.cateringPackages} gallery=${counts.galleryItems} ` +
      `videos=${counts.videos} pages=${counts.pages}`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync:content] Failed: ${message}`);
    process.exitCode = 1;
  });
}
