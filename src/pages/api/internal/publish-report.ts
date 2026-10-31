import type { APIRoute } from 'astro';
import { getActivePublication, markBuilt } from '../../../core/operational/publication-service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Called by the post-build `report:publish` step on Vercel. Marks the active
 * publication as built; the deployment is only shown as published once Vercel
 * confirms it is READY.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = (process.env.PUBLISH_REPORT_SECRET ?? '').trim();
  const provided = (request.headers.get('x-publish-secret') ?? '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse({ status: 'error', message: 'Unauthorized.' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body.' }, 400);
  }

  const contentVersion = String(body.contentVersion ?? '').trim();
  if (!contentVersion) {
    return jsonResponse({ status: 'error', message: 'contentVersion is required.' }, 400);
  }

  const active = await getActivePublication();
  if (!active) {
    return jsonResponse({ status: 'ok', recorded: false, reason: 'no_active_publication' }, 202);
  }

  await markBuilt(active.id, {
    builtVersion: contentVersion,
    deploymentUrl: String(body.deploymentUrl ?? '').trim(),
    deploymentId: String(body.deploymentId ?? '').trim(),
  });

  return jsonResponse({ status: 'ok', recorded: true, publicationId: active.id, builtVersion: contentVersion });
};
