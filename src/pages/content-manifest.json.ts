import type { APIRoute } from 'astro';
import { getSnapshotManifest } from '../core/content/snapshot';

export const prerender = true;

/**
 * Public, static record of the content version currently deployed. The admin
 * Content Studio reads it to show which published version is live.
 */
export const GET: APIRoute = async () => {
  const manifest = getSnapshotManifest();
  const body = manifest ?? {
    schemaVersion: 0,
    contentVersion: null,
    generatedAt: null,
    source: null,
    counts: null,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
