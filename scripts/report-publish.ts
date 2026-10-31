import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SnapshotManifest } from '../src/core/content/snapshot-types';

export interface ReportConfig {
  url: string;
  secret: string;
  manifestPath: string;
}

export function resolveReportConfig(
  env: Record<string, string | undefined> = process.env,
): { config: ReportConfig | null; missing: string[] } {
  const missing = ['PUBLISH_REPORT_URL', 'PUBLISH_REPORT_SECRET'].filter((key) => !(env[key] ?? '').trim());
  if (missing.length > 0) return { config: null, missing };

  return {
    config: {
      url: env.PUBLISH_REPORT_URL!.trim(),
      secret: env.PUBLISH_REPORT_SECRET!.trim(),
      manifestPath: resolve(process.cwd(), env.CONTENT_SNAPSHOT_DIR || 'content-snapshot', 'manifest.json'),
    },
    missing: [],
  };
}

export interface PublicationReport {
  contentVersion: string;
  generatedAt: string;
  counts: SnapshotManifest['counts'];
  deploymentUrl: string;
}

export function buildReport(manifest: SnapshotManifest, env: Record<string, string | undefined> = process.env): PublicationReport {
  const deploymentUrl = (env.VERCEL_URL || '').trim();
  return {
    contentVersion: manifest.contentVersion,
    generatedAt: manifest.generatedAt,
    counts: manifest.counts,
    deploymentUrl,
  };
}

export async function reportPublication(
  config: ReportConfig,
  report: PublicationReport,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-publish-secret': config.secret,
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if ((process.env.VERCEL_ENV || '') !== 'production') {
    console.log('[report:publish] Skipped (not a production deployment).');
    return;
  }

  const { config, missing } = resolveReportConfig();
  if (!config) {
    console.log(`[report:publish] Skipped (missing ${missing.join(', ')}).`);
    return;
  }

  let manifest: SnapshotManifest;
  try {
    manifest = JSON.parse(readFileSync(config.manifestPath, 'utf8')) as SnapshotManifest;
  } catch {
    console.warn('[report:publish] No manifest to report; continuing.');
    return;
  }

  const ok = await reportPublication(config, buildReport(manifest));
  if (ok) {
    console.log(`[report:publish] Reported v${manifest.contentVersion}.`);
  } else {
    console.warn('[report:publish] Report was not accepted; the deployment is unaffected.');
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    console.warn('[report:publish] Report failed; continuing.', error);
  });
}
