import { randomUUID } from 'node:crypto';
import { getNeonClient, type NeonOperationalClient } from './neon-client';
import { getD1Client } from '../content/d1-client';
import {
  buildManifest,
  buildSnapshot,
  fetchPublicContentRows,
  validateSnapshotData,
  type SnapshotRowFetcher,
} from '../content/snapshot-builder';
import type { SnapshotManifest } from '../content/snapshot-types';

export type PublicationStatus = 'requested' | 'deploying' | 'built' | 'published' | 'failed';

export const ACTIVE_PUBLICATION_STATUSES: PublicationStatus[] = ['requested', 'deploying', 'built'];

export interface ContentPublication {
  id: string;
  requested_by: number | null;
  requested_by_name: string;
  status: PublicationStatus;
  requested_version: string;
  built_version: string;
  published_version: string;
  deploy_hook_status: number | null;
  deployment_id: string;
  deployment_url: string;
  error: string;
  requested_at: string;
  built_at: string | null;
  completed_at: string | null;
}

export interface CreatePublicationInput {
  requestedBy: number | null;
  requestedByName: string;
  requestedVersion: string;
}

export interface CreatePublicationResult {
  created: boolean;
  publication?: ContentPublication;
  reason?: 'in_progress';
}

export interface VercelConfig {
  token: string;
  projectId: string;
  teamId: string;
  configured: boolean;
}

export interface VercelDeployment {
  uid?: string;
  url?: string;
  state?: string;
  readyState?: string;
  createdAt?: number;
  errorMessage?: string;
}

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS content_publications (
  id                TEXT PRIMARY KEY,
  requested_by      INTEGER,
  requested_by_name TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'requested',
  requested_version TEXT NOT NULL DEFAULT '',
  built_version     TEXT NOT NULL DEFAULT '',
  published_version TEXT NOT NULL DEFAULT '',
  deploy_hook_status INTEGER,
  deployment_id     TEXT NOT NULL DEFAULT '',
  deployment_url    TEXT NOT NULL DEFAULT '',
  error             TEXT NOT NULL DEFAULT '',
  requested_at      TEXT NOT NULL,
  built_at          TEXT,
  completed_at      TEXT
)`;

const TABLE_INDEX_DDL =
  'CREATE INDEX IF NOT EXISTS idx_content_publications_status ON content_publications(status)';

const ensuredClients = new WeakSet<NeonOperationalClient>();
const ensureInflight = new WeakMap<NeonOperationalClient, Promise<void>>();

/**
 * Idempotently creates the publications table. Works on Neon PostgreSQL and on
 * the local SQLite fallback used by development and tests. The DDL runs once
 * per client instance.
 */
export async function ensurePublicationsTable(client: NeonOperationalClient = getNeonClient()): Promise<void> {
  if (ensuredClients.has(client)) return;

  const inflight = ensureInflight.get(client);
  if (inflight) return inflight;

  const promise = (async () => {
    await client.query(TABLE_DDL);
    await client.query(TABLE_INDEX_DDL);
  })()
    .then(() => {
      ensuredClients.add(client);
    })
    .finally(() => {
      ensureInflight.delete(client);
    });

  ensureInflight.set(client, promise);
  return promise;
}

function rowToPublication(row: Record<string, any>): ContentPublication {
  return {
    id: String(row.id),
    requested_by: row.requested_by === null || row.requested_by === undefined ? null : Number(row.requested_by),
    requested_by_name: String(row.requested_by_name ?? ''),
    status: (row.status ?? 'requested') as PublicationStatus,
    requested_version: String(row.requested_version ?? ''),
    built_version: String(row.built_version ?? ''),
    published_version: String(row.published_version ?? ''),
    deploy_hook_status:
      row.deploy_hook_status === null || row.deploy_hook_status === undefined
        ? null
        : Number(row.deploy_hook_status),
    deployment_id: String(row.deployment_id ?? ''),
    deployment_url: String(row.deployment_url ?? ''),
    error: String(row.error ?? ''),
    requested_at: String(row.requested_at ?? ''),
    built_at: row.built_at ?? null,
    completed_at: row.completed_at ?? null,
  };
}

export function vercelConfig(env: Record<string, string | undefined> = process.env): VercelConfig {
  const token = (env.VERCEL_API_TOKEN ?? '').trim();
  const projectId = (env.VERCEL_PROJECT_ID ?? '').trim();
  const teamId = (env.VERCEL_TEAM_ID ?? '').trim();
  return { token, projectId, teamId, configured: Boolean(token && projectId) };
}

export function deployHookConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.VERCEL_DEPLOY_HOOK_URL ?? '').trim());
}

export function dashboardUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.VERCEL_DASHBOARD_URL ?? '').trim() || 'https://vercel.com/dashboard';
}

/**
 * Reads the manifest served by the currently live deployment so the CMS can
 * show which content version is actually published right now.
 */
export async function fetchLiveManifest(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<{ contentVersion: string | null; generatedAt: string | null } | null> {
  try {
    const response = await fetcher(new URL('/content-manifest.json', origin).toString(), {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { contentVersion?: string | null; generatedAt?: string | null };
    return {
      contentVersion: body.contentVersion ?? null,
      generatedAt: body.generatedAt ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Runs the same fetch/build/validate pipeline the build uses, against live D1,
 * so a publication can never start when the snapshot would be invalid.
 */
export async function validatePublishReadiness(
  fetcher: SnapshotRowFetcher = getD1Client(),
): Promise<SnapshotManifest> {
  const rows = await fetchPublicContentRows(fetcher);
  const snapshot = buildSnapshot(rows);
  validateSnapshotData(snapshot);
  return buildManifest(snapshot);
}

export async function getPublication(
  id: string,
  client: NeonOperationalClient = getNeonClient(),
): Promise<ContentPublication | null> {
  await ensurePublicationsTable(client);
  const res = await client.query('SELECT * FROM content_publications WHERE id = $1 LIMIT 1', [id]);
  const row = res.rows?.[0];
  return row ? rowToPublication(row) : null;
}

export async function listPublications(
  limit = 10,
  client: NeonOperationalClient = getNeonClient(),
): Promise<ContentPublication[]> {
  await ensurePublicationsTable(client);
  const res = await client.query(
    'SELECT * FROM content_publications ORDER BY requested_at DESC LIMIT $1',
    [limit],
  );
  return (res.rows ?? []).map(rowToPublication);
}

export async function listActivePublications(
  client: NeonOperationalClient = getNeonClient(),
): Promise<ContentPublication[]> {
  await ensurePublicationsTable(client);
  const res = await client.query(
    "SELECT * FROM content_publications WHERE status IN ('requested','deploying','built') ORDER BY requested_at ASC",
  );
  return (res.rows ?? []).map(rowToPublication);
}

export async function getActivePublication(
  client: NeonOperationalClient = getNeonClient(),
): Promise<ContentPublication | null> {
  const active = await listActivePublications(client);
  return active.length > 0 ? active[active.length - 1] : null;
}

/**
 * Creates a publication job unless one is already in flight. The guard is a
 * single conditional INSERT, so two requests racing cannot both succeed.
 */
export async function createPublication(
  input: CreatePublicationInput,
  client: NeonOperationalClient = getNeonClient(),
): Promise<CreatePublicationResult> {
  await ensurePublicationsTable(client);

  const id = randomUUID();
  const requestedAt = new Date().toISOString();
  const res = await client.query(
    `INSERT INTO content_publications
       (id, requested_by, requested_by_name, status, requested_version, requested_at)
     SELECT $1, $2, $3, 'requested', $4, $5
     WHERE NOT EXISTS (
       SELECT 1 FROM content_publications WHERE status IN ('requested','deploying','built')
     )`,
    [id, input.requestedBy, input.requestedByName, input.requestedVersion, requestedAt],
  );

  if ((res.rowCount ?? 0) === 0) {
    return { created: false, reason: 'in_progress' };
  }

  return { created: true, publication: (await getPublication(id, client)) ?? undefined };
}

const UPDATABLE_COLUMNS = new Set([
  'status',
  'built_version',
  'published_version',
  'deploy_hook_status',
  'deployment_id',
  'deployment_url',
  'error',
  'built_at',
  'completed_at',
]);

async function updatePublication(
  id: string,
  fields: Record<string, unknown>,
  client: NeonOperationalClient,
): Promise<void> {
  const entries = Object.entries(fields).filter(([key]) => UPDATABLE_COLUMNS.has(key));
  if (entries.length === 0) return;

  // Placeholders are numbered in appearance order because the SQLite fallback
  // rewrites $1, $2, … to positional ?s.
  const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(', ');
  await client.query(
    `UPDATE content_publications SET ${assignments} WHERE id = $${entries.length + 1}`,
    [...entries.map(([, value]) => value), id],
  );
}

export async function markDeploying(
  id: string,
  data: { deployHookStatus: number; deploymentUrl?: string },
  client: NeonOperationalClient = getNeonClient(),
): Promise<void> {
  await updatePublication(
    id,
    {
      status: 'deploying',
      deploy_hook_status: data.deployHookStatus,
      deployment_url: data.deploymentUrl ?? '',
    },
    client,
  );
}

export async function markBuilt(
  id: string,
  data: { builtVersion: string; deploymentUrl?: string; deploymentId?: string },
  client: NeonOperationalClient = getNeonClient(),
): Promise<void> {
  await updatePublication(
    id,
    {
      status: 'built',
      built_version: data.builtVersion,
      built_at: new Date().toISOString(),
      ...(data.deploymentUrl ? { deployment_url: data.deploymentUrl } : {}),
      ...(data.deploymentId ? { deployment_id: data.deploymentId } : {}),
    },
    client,
  );
}

export async function markPublished(
  id: string,
  data: { publishedVersion: string; deploymentId?: string; deploymentUrl?: string },
  client: NeonOperationalClient = getNeonClient(),
): Promise<void> {
  await updatePublication(
    id,
    {
      status: 'published',
      published_version: data.publishedVersion,
      completed_at: new Date().toISOString(),
      error: '',
      ...(data.deploymentId ? { deployment_id: data.deploymentId } : {}),
      ...(data.deploymentUrl ? { deployment_url: data.deploymentUrl } : {}),
    },
    client,
  );
}

export async function markFailed(
  id: string,
  error: string,
  client: NeonOperationalClient = getNeonClient(),
): Promise<void> {
  await updatePublication(
    id,
    { status: 'failed', error, completed_at: new Date().toISOString() },
    client,
  );
}

/**
 * POSTs the Vercel deploy hook. The URL is read from the environment and is
 * never returned to callers or rendered in the CMS.
 */
export async function triggerDeployHook(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const url = (env.VERCEL_DEPLOY_HOOK_URL ?? '').trim();
  if (!url) {
    throw new Error('Publishing is not configured: VERCEL_DEPLOY_HOOK_URL is missing on the server.');
  }

  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'event-point-content-studio' }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`The Vercel deploy hook rejected the request (status ${response.status}).`);
  }

  return response.status;
}

export async function fetchVercelDeployments(
  config: VercelConfig,
  fetcher: typeof fetch = fetch,
): Promise<VercelDeployment[] | null> {
  if (!config.configured) return null;

  const params = new URLSearchParams({
    projectId: config.projectId,
    limit: '20',
    target: 'production',
  });
  if (config.teamId) params.set('teamId', config.teamId);

  try {
    const response = await fetcher(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { deployments?: VercelDeployment[] };
    return body.deployments ?? [];
  } catch {
    return null;
  }
}

function normalizeDeploymentUrl(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

export function matchDeployment(
  publication: ContentPublication,
  deployments: VercelDeployment[],
): VercelDeployment | null {
  if (publication.deployment_url) {
    const target = normalizeDeploymentUrl(publication.deployment_url);
    const exact = deployments.find(
      (deployment) => deployment.url && normalizeDeploymentUrl(deployment.url) === target,
    );
    if (exact) return exact;
  }

  const requestedAt = Date.parse(publication.requested_at);
  if (Number.isNaN(requestedAt)) return null;
  const cutoff = requestedAt - 5 * 60 * 1000;

  const candidates = deployments
    .filter((deployment) => typeof deployment.createdAt === 'number' && deployment.createdAt >= cutoff)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  return candidates[0] ?? null;
}

/**
 * Confirms in-flight publications against Vercel. Nothing is marked published
 * without a READY deployment; without Vercel API credentials the job stays at
 * "built" and the CMS says so explicitly.
 */
export async function refreshPublicationStatuses(
  client: NeonOperationalClient = getNeonClient(),
  fetcher: typeof fetch = fetch,
): Promise<{ checked: number; updated: number; vercelConfigured: boolean }> {
  const active = await listActivePublications(client);
  if (active.length === 0) {
    return { checked: 0, updated: 0, vercelConfigured: vercelConfig().configured };
  }

  const config = vercelConfig();
  let updated = 0;

  // Without the API we can still fail publications that were never confirmed.
  const staleCutoff = Date.now() - 2 * 60 * 60 * 1000;

  if (config.configured) {
    const deployments = await fetchVercelDeployments(config, fetcher);
    if (deployments) {
      const seen = new Set<string>();

      for (const publication of active) {
        const deployment = matchDeployment(publication, deployments);
        if (!deployment) continue;
        const key = deployment.uid || deployment.url || '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);

        const state = String(deployment.state ?? deployment.readyState ?? '').toUpperCase();
        if (state === 'READY') {
          await markPublished(
            publication.id,
            {
              publishedVersion: publication.built_version || publication.requested_version,
              deploymentId: deployment.uid,
              deploymentUrl: deployment.url,
            },
            client,
          );
          updated += 1;
        } else if (state === 'ERROR' || state === 'CANCELED') {
          await markFailed(
            publication.id,
            deployment.errorMessage || `Vercel reported the deployment as ${state.toLowerCase()}.`,
            client,
          );
          updated += 1;
        } else if (deployment.uid || deployment.url) {
          await updatePublication(
            publication.id,
            { deployment_id: deployment.uid ?? '', deployment_url: deployment.url ?? '' },
            client,
          );
        }
      }
    }
  }

  for (const publication of active) {
    if (publication.status !== 'requested') continue;
    const requestedAt = Date.parse(publication.requested_at);
    if (!Number.isNaN(requestedAt) && requestedAt < staleCutoff) {
      await markFailed(
        publication.id,
        'The deployment was never confirmed. Trigger a new publish once Vercel is reachable.',
        client,
      );
      updated += 1;
    }
  }

  return { checked: active.length, updated, vercelConfigured: config.configured };
}
