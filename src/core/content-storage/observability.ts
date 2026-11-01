/**
 * Observability for the object-storage content read path.
 *
 * A storage fault must never be silent: every fallback emits one structured
 * log line and increments a counter that can be exported or scraped. In
 * `strict` mode the same failure fails the request instead of degrading to D1,
 * which is what a Preview deployment should use to prove the new source works.
 *
 * Configuration:
 *   CONTENT_FALLBACK=d1      (default) log, count, serve D1
 *   CONTENT_FALLBACK=strict  log, count, fail the request
 */
import { getContentFallbackCounters, getPointer } from './read';

export type ContentFallbackMode = 'd1' | 'strict';

export type ContentFallbackReason =
  | 'unpublished'
  | 'integrity'
  | 'unavailable'
  | 'validation'
  | 'error';

export interface ContentFallbackEvent {
  pageId: string;
  siteVersion: string;
  reason: ContentFallbackReason;
  fallback: 'd1';
  message: string;
  label: string;
}

export function contentFallbackMode(): ContentFallbackMode {
  const configured = (process.env.CONTENT_FALLBACK ?? '').trim().toLowerCase();
  return configured === 'strict' ? 'strict' : 'd1';
}

function classify(error: unknown): ContentFallbackReason {
  const code = (error as { code?: string })?.code;
  if (code === 'unpublished' || code === 'integrity' || code === 'unavailable') return code;
  if (code === 'validation') return 'validation';
  return 'error';
}

/** The active version, or 'unknown' when the pointer itself is what failed. */
async function currentSiteVersionSafe(): Promise<string> {
  try {
    const pointer = await getPointer();
    return pointer.siteVersion || 'unpublished';
  } catch {
    return 'unknown';
  }
}

/**
 * Structured, single-line JSON so it can be grepped in Vercel logs and parsed by
 * any log pipeline without a custom format.
 */
function logFallback(event: ContentFallbackEvent): void {
  const payload = JSON.stringify({
    event: 'content_fallback',
    level: 'warn',
    ...event,
    mode: contentFallbackMode(),
  });
  console.warn(payload);
}

/**
 * Runs a storage read and decides what a failure means.
 *
 * Returns `null` when the caller should continue with D1 (default mode), or
 * throws when `CONTENT_FALLBACK=strict`.
 */
export async function withContentFallback<T>(
  label: string,
  pageId: string,
  operation: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const event: ContentFallbackEvent = {
      pageId,
      siteVersion: await currentSiteVersionSafe(),
      reason: classify(error),
      fallback: 'd1',
      label,
      message: error instanceof Error ? error.message : String(error),
    };

    logFallback(event);
    getContentFallbackCounters().record(event);

    if (contentFallbackMode() === 'strict') {
      throw error;
    }
    return null;
  }
}
