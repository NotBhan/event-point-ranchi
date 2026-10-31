import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { PublicContentRows } from '../src/core/content/snapshot-types';

const { NeonOperationalClient } = await import('../src/core/operational/neon-client');
const {
  createPublication,
  deployHookConfigured,
  ensurePublicationsTable,
  getActivePublication,
  listPublications,
  markBuilt,
  markDeploying,
  markFailed,
  markPublished,
  matchDeployment,
  refreshPublicationStatuses,
  triggerDeployHook,
  validatePublishReadiness,
} = await import('../src/core/operational/publication-service');
const { SnapshotValidationError } = await import('../src/core/content/snapshot-builder');

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-publication-test-'));

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let counter = 0;
function freshClient(): InstanceType<typeof NeonOperationalClient> {
  counter += 1;
  return new NeonOperationalClient({
    databaseUrl: '',
    localDbPath: join(tempRoot, `publications-${counter}.db`),
  });
}

const VERCEL_KEYS = ['VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID'];

async function withVercelEnv<T>(values: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of VERCEL_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, values);

  try {
    return await run();
  } finally {
    for (const key of VERCEL_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function publishableRows(): PublicContentRows {
  const page = (page_key: string) => ({
    id: 1,
    page_key,
    title: 'title',
    subtitle: '',
    description: '',
    banner_image_url: '',
    banner_enabled: 1,
    content_json: '{}',
    seo_title: '',
    seo_description: '',
    og_image_url: '',
    published: 1,
    created_at: '',
    updated_at: '',
  });

  return {
    settings: { id: 'global', name: 'Event Point', phone: '+91 90000 00000', email: 'a@b.test', address: 'Ranchi' },
    pages: ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'].map(page),
    seo: [],
    homeSections: [],
    services: [],
    mandaps: [
      {
        id: 1,
        name: 'Mandap',
        slug: 'mandap',
        image_url: '',
        features_json: '[]',
        is_visible: 1,
        sort_order: 0,
      },
    ],
    mandapGallery: [],
    stages: [
      {
        id: 2,
        name: 'Stage',
        slug: 'stage',
        image_url: '',
        is_visible: 1,
        sort_order: 0,
      },
    ],
    stageGallery: [],
    furnitureCategories: [{ id: 3, name: 'Chairs', slug: 'chairs', is_visible: 1, sort_order: 0 }],
    furnitureItems: [{ id: 4, category_id: 3, name: 'Chair', slug: 'chair', is_visible: 1, sort_order: 0 }],
    cateringPackages: [
      {
        id: 9,
        name: 'Silver',
        slug: 'silver',
        description: '',
        badge: '',
        image_url: '',
        price_per_plate_paise: 50000,
        show_on_home: 1,
        is_visible: 1,
        sort_order: 0,
      },
    ],
    cateringFeatures: [{ id: 10, package_id: 9, name: 'Starter' }],
    bannerFeatures: [{ id: 11, package_id: 9, name: 'Live counters' }],
    guestPricing: [{ id: 12, package_id: 9, guest_count: 100, price_per_plate_paise: 50000, sort: 1 }],
    menuSections: [{ id: 13, package_id: 9, title: 'Welcome', has_category: 1, available_items: 0, max_selection: 3, sort: 1 }],
    menuCategories: [{ id: 14, section_id: 13, title: 'Bites', sort: 1 }],
    menuItems: [{ id: 15, category_id: 14, name: 'Paneer Tikka', is_available: 1 }],
    galleryCategories: [{ id: 5, name: 'Designs', slug: 'designs', is_visible: 1, sort_order: 0 }],
    galleryItems: [{ id: 6, category_id: 5, image_url: '/storage/a.webp', is_visible: 1, sort_order: 0 }],
    videos: [],
  };
}

function batchResults(rows: PublicContentRows) {
  return [
    { results: rows.settings ? [rows.settings] : [] },
    { results: rows.pages },
    { results: rows.seo },
    { results: rows.homeSections },
    { results: rows.services },
    { results: rows.mandaps },
    { results: rows.mandapGallery },
    { results: rows.stages },
    { results: rows.stageGallery },
    { results: rows.furnitureCategories },
    { results: rows.furnitureItems },
    { results: rows.cateringPackages },
    { results: rows.cateringFeatures },
    { results: rows.bannerFeatures },
    { results: rows.guestPricing },
    { results: rows.menuSections },
    { results: rows.menuCategories },
    { results: rows.menuItems },
    { results: rows.galleryCategories },
    { results: rows.galleryItems },
    { results: rows.videos },
  ];
}

test('creates the publications table once per client', async () => {
  const client = freshClient();
  await ensurePublicationsTable(client);
  await ensurePublicationsTable(client);

  const res = await client.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='content_publications'",
  );
  assert.equal(res.rows.length, 1);
});

test('prevents concurrent publications and allows a retry after failure', async () => {
  const client = freshClient();
  await ensurePublicationsTable(client);

  const first = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v1' },
    client,
  );
  assert.equal(first.created, true);
  assert.ok(first.publication);

  const duplicate = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v2' },
    client,
  );
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reason, 'in_progress');

  await markDeploying(first.publication!.id, { deployHookStatus: 201 }, client);
  const whileDeploying = await createPublication(
    { requestedBy: 2, requestedByName: 'Editor', requestedVersion: 'v2' },
    client,
  );
  assert.equal(whileDeploying.created, false);

  await markFailed(first.publication!.id, 'deploy hook rejected the request', client);
  const retry = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v2' },
    client,
  );
  assert.equal(retry.created, true);

  const active = await getActivePublication(client);
  assert.equal(active?.id, retry.publication!.id);
  assert.equal(active?.status, 'requested');

  const history = await listPublications(10, client);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, 'requested');
});

test('walks requested → deploying → built → published', async () => {
  const client = freshClient();
  await ensurePublicationsTable(client);

  const { publication } = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v9' },
    client,
  );
  const id = publication!.id;

  await markDeploying(id, { deployHookStatus: 201, deploymentUrl: 'event-point-abc.vercel.app' }, client);
  await markBuilt(id, { builtVersion: 'v9', deploymentUrl: 'event-point-abc.vercel.app' }, client);

  let active = await getActivePublication(client);
  assert.equal(active?.status, 'built');
  assert.equal(active?.built_version, 'v9');
  assert.ok(active?.built_at);

  await markPublished(id, { publishedVersion: 'v9', deploymentUrl: 'event-point-abc.vercel.app' }, client);

  active = await getActivePublication(client);
  assert.equal(active, null);

  const [latest] = await listPublications(1, client);
  assert.equal(latest.status, 'published');
  assert.equal(latest.published_version, 'v9');
  assert.ok(latest.completed_at);
});

test('confirms READY deployments through the Vercel API', async () => {
  const client = freshClient();
  await ensurePublicationsTable(client);
  const { publication } = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v-ready' },
    client,
  );
  await markDeploying(publication!.id, { deployHookStatus: 201 }, client);
  await markBuilt(publication!.id, { builtVersion: 'v-ready' }, client);

  await withVercelEnv({ VERCEL_API_TOKEN: 'token', VERCEL_PROJECT_ID: 'prj_1' }, async () => {
    const result = await refreshPublicationStatuses(client, (async () =>
      new Response(
        JSON.stringify({
          deployments: [
            { uid: 'dpl_1', url: 'event-point-ready.vercel.app', state: 'READY', createdAt: Date.now() },
          ],
        }),
        { status: 200 },
      )) as typeof fetch);

    assert.equal(result.vercelConfigured, true);
    assert.ok(result.updated >= 1);
  });

  const [latest] = await listPublications(1, client);
  assert.equal(latest.status, 'published');
  assert.equal(latest.published_version, 'v-ready');
  assert.equal(latest.deployment_id, 'dpl_1');
});

test('marks ERROR deployments as failed', async () => {
  const client = freshClient();
  await ensurePublicationsTable(client);
  const { publication } = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v-bad' },
    client,
  );
  await markDeploying(publication!.id, { deployHookStatus: 201 }, client);

  await withVercelEnv({ VERCEL_API_TOKEN: 'token', VERCEL_PROJECT_ID: 'prj_1' }, async () => {
    await refreshPublicationStatuses(client, (async () =>
      new Response(
        JSON.stringify({
          deployments: [
            {
              uid: 'dpl_2',
              url: 'event-point-bad.vercel.app',
              state: 'ERROR',
              createdAt: Date.now(),
              errorMessage: 'Build failed',
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch);
  });

  const [latest] = await listPublications(1, client);
  assert.equal(latest.status, 'failed');
  assert.equal(latest.error, 'Build failed');
});

test('without Vercel credentials a built publication is never reported as published', async () => {
  const client = freshClient();
  await ensurePublicationsTable(client);
  const { publication } = await createPublication(
    { requestedBy: 1, requestedByName: 'Admin', requestedVersion: 'v-silent' },
    client,
  );
  await markDeploying(publication!.id, { deployHookStatus: 201 }, client);
  await markBuilt(publication!.id, { builtVersion: 'v-silent' }, client);

  await withVercelEnv({}, async () => {
    const result = await refreshPublicationStatuses(client, (async () => {
      throw new Error('must not call Vercel without credentials');
    }) as unknown as typeof fetch);
    assert.equal(result.vercelConfigured, false);
    assert.equal(result.updated, 0);
  });

  const [latest] = await listPublications(1, client);
  assert.equal(latest.status, 'built');
});

test('readiness validation reuses the build snapshot rules', async () => {
  const valid = await validatePublishReadiness({
    async batch() {
      return batchResults(publishableRows()) as never;
    },
  });
  assert.equal(valid.counts.mandaps, 1);
  assert.ok(valid.contentVersion.length >= 8);

  await assert.rejects(
    validatePublishReadiness({
      async batch() {
        return batchResults({ ...publishableRows(), mandaps: [] }) as never;
      },
    }),
    SnapshotValidationError,
  );
});

test('deploy hook requires configuration and validates the response', async () => {
  assert.equal(deployHookConfigured({}), false);
  assert.equal(deployHookConfigured({ VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/hooks/x' }), true);

  await assert.rejects(triggerDeployHook({}, async () => new Response()), /not configured/);

  const status = await triggerDeployHook(
    { VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/hooks/x' },
    (async () => new Response('{}', { status: 201 })) as typeof fetch,
  );
  assert.equal(status, 201);

  await assert.rejects(
    triggerDeployHook(
      { VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/hooks/x' },
      (async () => new Response('nope', { status: 500 })) as typeof fetch,
    ),
    /rejected the request/,
  );
});

test('matches deployments by URL first and by time second', () => {
  const byUrl = matchDeployment(
    {
      id: 'p1',
      requested_at: new Date().toISOString(),
      deployment_url: 'https://event-point-one.vercel.app/',
      built_version: '',
      requested_version: '',
    } as never,
    [
      { uid: 'old', url: 'event-point-old.vercel.app', createdAt: Date.now() - 60_000 },
      { uid: 'new', url: 'event-point-one.vercel.app', createdAt: Date.now() },
    ],
  );
  assert.equal(byUrl?.uid, 'new');

  const byTime = matchDeployment(
    {
      id: 'p2',
      requested_at: new Date(Date.now() - 30_000).toISOString(),
      deployment_url: '',
      built_version: '',
      requested_version: '',
    } as never,
    [
      { uid: 'stale', url: 'event-point-stale.vercel.app', createdAt: Date.now() - 10 * 60_000 },
      { uid: 'fresh', url: 'event-point-fresh.vercel.app', createdAt: Date.now() - 10_000 },
    ],
  );
  assert.equal(byTime?.uid, 'fresh');
});

test('never confirms a publication against a deployment that predates the request', () => {
  const requestedAt = Date.now();
  const publication = {
    id: 'race',
    requested_at: new Date(requestedAt).toISOString(),
    deployment_url: '',
    built_version: '',
    requested_version: '',
  } as never;

  // Reproduces the production race: an already-READY deployment created
  // minutes before the publish request must not be mistaken for the build the
  // deploy hook is about to start.
  const stale = matchDeployment(publication, [
    { uid: 'live-before', url: 'event-point-live.vercel.app', createdAt: requestedAt - 159_000, state: 'READY' },
  ]);
  assert.equal(stale, null);

  // The hook's deployment appears seconds after the request and is the one
  // that gets confirmed.
  const fresh = matchDeployment(publication, [
    { uid: 'live-before', url: 'event-point-live.vercel.app', createdAt: requestedAt - 159_000, state: 'READY' },
    { uid: 'hook-build', url: 'event-point-hook.vercel.app', createdAt: requestedAt + 8_000, state: 'BUILDING' },
  ]);
  assert.equal(fresh?.uid, 'hook-build');
});
