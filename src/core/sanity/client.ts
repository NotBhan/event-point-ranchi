import { createClient, type SanityClient } from '@sanity/client';
import { getSanityConfig, isSanityConfigured } from './config';

let clientInstance: SanityClient | null = null;
let previewClientInstance: SanityClient | null = null;

// In-memory cache for SSR performance and zero-redeploy content freshness
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export function getSanityClient(preview = false): SanityClient | null {
  if (!isSanityConfigured()) return null;

  const config = getSanityConfig();

  if (preview) {
    if (!previewClientInstance) {
      previewClientInstance = createClient({
        projectId: config.projectId,
        dataset: config.dataset,
        apiVersion: config.apiVersion,
        useCdn: false,
        token: config.token,
        perspective: 'previewDrafts',
      });
    }
    return previewClientInstance;
  }

  if (!clientInstance) {
    clientInstance = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion,
      useCdn: config.useCdn,
      perspective: 'published',
    });
  }

  return clientInstance;
}

export async function fetchSanity<T>(
  query: string,
  params: Record<string, unknown> = {},
  options: { preview?: boolean; skipCache?: boolean } = {},
): Promise<T | null> {
  const { preview = false, skipCache = false } = options;
  const client = getSanityClient(preview);

  if (!client) {
    return null;
  }

  const cacheKey = `${query}::${JSON.stringify(params)}::${preview}`;

  if (!skipCache && !preview) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  try {
    const data = await client.fetch<T>(query, params);
    if (!preview) {
      cache.set(cacheKey, { data, timestamp: Date.now() });
    }
    return data;
  } catch (error) {
    console.warn('[sanity] Query fetch failed, falling back to local defaults:', (error as Error).message);
    return null;
  }
}

export function clearSanityCache(): void {
  cache.clear();
}
