/**
 * Bounded in-process page cache for anonymous public HTML.
 *
 * Why: every public page is server-rendered per request, and on deployment
 * each cold instance pays remote content-store round trips. Caching the
 * finished HTML for a short TTL removes repeated rendering work while staying
 * correct:
 *
 *  - only allow-listed marketing routes (none of them embed CSRF tokens or
 *    POST forms — enforced by a regression test),
 *  - only responses for visitors without a session or flash cookie,
 *  - instant purge on any state-changing request, so admin edits show up
 *    immediately on the instance that handled the write,
 *  - bounded TTL keeps other instances fresh (no unbounded staleness).
 *
 * Deliberately NOT cached: admin pages, forms, API responses, customer data,
 * payment data and any request carrying a session cookie.
 */

export interface PageCacheEntry {
  body: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  storedAt: number;
}

interface PageCacheState {
  entries: Map<string, PageCacheEntry>;
}

interface PageCacheScope {
  __eventPointPageCache?: PageCacheState;
}

const scope = globalThis as typeof globalThis & PageCacheScope;

const MAX_ENTRIES = (() => {
  const configured = Number(process.env.PAGE_CACHE_MAX_ENTRIES);
  return Number.isFinite(configured) && configured > 0 ? configured : 100;
})();

const TTL_MS = (() => {
  const configured = Number(process.env.PAGE_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 45_000;
})();

/** Marketing routes with no CSRF tokens or POST forms. */
const CACHEABLE_EXACT = new Set([
  '/',
  '/mandaps',
  '/stages',
  '/equipment',
  '/gallery',
  '/catering',
  '/halls',
  '/terms',
  '/privacy',
  '/payment-policy',
  '/grievance',
  '/cancellation-refund',
]);

const CACHEABLE_PREFIXES = ['/mandaps/', '/stages/', '/catering/', '/halls/'];

function isDevMode(): boolean {
  // Vite/Astro statically replaces import.meta.env.DEV; outside Astro (tests,
  // scripts) it is undefined and we fall back to NODE_ENV.
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  if (typeof dev === 'boolean') return dev;
  return process.env.NODE_ENV === 'development';
}

export function isPageCacheEnabled(): boolean {
  const flag = process.env.PAGE_CACHE;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return !isDevMode();
}

export function isCacheablePagePath(pathname: string): boolean {
  if (CACHEABLE_EXACT.has(pathname)) return true;
  return CACHEABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length);
}

function state(): PageCacheState {
  if (!scope.__eventPointPageCache) {
    scope.__eventPointPageCache = { entries: new Map() };
  }
  return scope.__eventPointPageCache;
}

export function getCachedPage(key: string): PageCacheEntry | null {
  const cache = state();
  const entry = cache.entries.get(key);
  if (!entry) return null;

  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.entries.delete(key);
    return null;
  }

  // Refresh LRU position
  cache.entries.delete(key);
  cache.entries.set(key, entry);
  return entry;
}

export function storePage(key: string, entry: Omit<PageCacheEntry, 'storedAt'>): void {
  const cache = state();

  if (cache.entries.size >= MAX_ENTRIES) {
    const oldest = cache.entries.keys().next().value;
    if (oldest !== undefined) cache.entries.delete(oldest);
  }

  cache.entries.set(key, { ...entry, storedAt: Date.now() });
}

export function invalidatePageCache(): void {
  state().entries.clear();
}

export function pageCacheStats(): { entries: number; maxEntries: number; ttlMs: number } {
  return { entries: state().entries.size, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
}

export const PAGE_CACHE_HEADER = 'x-page-cache';
