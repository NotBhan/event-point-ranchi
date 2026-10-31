import type { APIRoute } from 'astro';
import {
  dashboardUrl,
  deployHookConfigured,
  listPublications,
  refreshPublicationStatuses,
  vercelConfig,
} from '../../../../core/operational/publication-service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Admin-only publication status. Confirms in-flight deployments against Vercel
 * before reporting them as published.
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.auth?.isAdmin) {
    return jsonResponse({ status: 'error', message: 'Administrator access is required.' }, 403);
  }

  try {
    const refresh = await refreshPublicationStatuses();
    const publications = await listPublications(8);
    return jsonResponse({
      status: 'ok',
      ...refresh,
      publications,
      config: {
        deployHookConfigured: deployHookConfigured(),
        vercelConfigured: vercelConfig().configured,
        dashboardUrl: dashboardUrl(),
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not read publication status.',
      },
      500,
    );
  }
};
