import { defineMiddleware } from 'astro:middleware';
import { getAuth } from './core/auth';
import { csrfMatches, ensureCsrf, submittedCsrfToken } from './core/csrf';
import { takeFlash } from './core/flash';
import { getSiteSettings } from './core/content/service';
import {
  buildServerTimingHeader,
  currentPerf,
  finishPerfRequest,
  perfTimingEnabled,
  runWithPerf,
} from './core/perf';
import {
  getCachedPage,
  invalidatePageCache,
  isCacheablePagePath,
  isPageCacheEnabled,
  PAGE_CACHE_HEADER,
  storePage,
  type PageCacheEntry,
} from './core/page-cache';

function withServerTiming(response: Response, method: string, pathname: string): Response {
  if (!perfTimingEnabled()) return response;

  finishPerfRequest(method, pathname, response.status);
  const header = buildServerTimingHeader(currentPerf());
  if (!header) return response;

  const headers = new Headers(response.headers);
  headers.set('Server-Timing', header);

  const nullBody =
    method === 'HEAD' || response.status === 204 || response.status === 205 || response.status === 304;

  return new Response(nullBody ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cachedPageResponse(entry: PageCacheEntry): Response {
  const headers = new Headers(entry.headers);
  headers.set(PAGE_CACHE_HEADER, 'HIT');
  return new Response(entry.body, { status: entry.status, headers });
}

const STATIC_ASSET_PREFIXES = ['/storage/', '/uploads/', '/_astro/', '/images/'];

// Server-to-server endpoints authenticate with their own secret header instead
// of the browser CSRF token.
const CSRF_EXEMPT_PREFIXES = ['/api/internal/'];

function isStaticAssetRequest(pathname: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname === '/favicon.ico' || pathname.startsWith('/favicon')) return true;
  return STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const method = context.request.method.toUpperCase();

  // Static assets and stored media never need CSRF, flash or session state.
  // Skipping them avoids an auth round trip (and cookie writes) per image.
  if (isStaticAssetRequest(context.url.pathname, method)) {
    return next();
  }

  // Prerendered pages render at build time, where cookies, sessions and CSRF
  // do not exist. Building them must not try to mutate a response cookie.
  if (context.isPrerendered) {
    return next();
  }

  return runWithPerf(async () => {
    const csrf = ensureCsrf(context.cookies);
    context.locals.csrf = csrf;
    context.locals.auth = await getAuth(context.cookies);
    context.locals.flash = takeFlash(context.cookies);

    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (isMutation && !CSRF_EXEMPT_PREFIXES.some((prefix) => context.url.pathname.startsWith(prefix))) {
      const submitted = await submittedCsrfToken(context.request);
      if (!csrfMatches(submitted, csrf)) {
        return new Response('Invalid or missing CSRF token. Refresh the page and try again.', {
          status: 403,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    }

    // Start the site-settings fetch in parallel with route handling. Layouts
    // await the same in-flight promise, so cold renders no longer pay a second
    // sequential content-store round trip after the page fetched its own data.
    if (method === 'GET' && !context.url.pathname.startsWith('/api/')) {
      void getSiteSettings().catch(() => {});
    }

    // Anonymous marketing HTML is cached briefly; session and flash cookies
    // bypass the cache so personalised pages are never shared.
    const cacheable =
      method === 'GET' &&
      isPageCacheEnabled() &&
      isCacheablePagePath(context.url.pathname) &&
      !context.url.search &&
      !context.cookies.get('rp_session') &&
      !context.cookies.get('rp_flash');

    if (cacheable) {
      const cached = getCachedPage(context.url.pathname);
      if (cached) {
        return withServerTiming(cachedPageResponse(cached), method, context.url.pathname);
      }
    }

    const response = await next();

    if (isMutation && response.status < 400) {
      // Content changed: drop cached pages so the next render is fresh.
      invalidatePageCache();
    }

    if (
      cacheable &&
      response.status === 200 &&
      (response.headers.get('content-type') ?? '').includes('text/html')
    ) {
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (key === 'set-cookie' || key === 'content-length' || key === 'server-timing') return;
        headers[key] = value;
      });

      storePage(context.url.pathname, { body, status: 200, contentType: 'text/html; charset=utf-8', headers });

      const replay = new Headers(headers);
      replay.set(PAGE_CACHE_HEADER, 'MISS');
      return withServerTiming(new Response(body, { status: 200, headers: replay }), method, context.url.pathname);
    }

    return withServerTiming(response, method, context.url.pathname);
  });
});
