import type { APIRoute } from 'astro';
import { popularRanchiPlaces, searchRanchiPlaces, type VenueSuggestion } from '../../core/venues/ranchi';
import { mapPhotonPlaces, mergeVenueSuggestions } from '../../core/venues/map-search';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expires: number; results: VenueSuggestion[] }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
    },
  });
}

async function mapSuggestions(query: string): Promise<VenueSuggestion[]> {
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.results;

  try {
    const endpoint = new URL('https://photon.komoot.io/api/');
    endpoint.searchParams.set('q', `${query} Ranchi Jharkhand`);
    endpoint.searchParams.set('lat', '23.3441');
    endpoint.searchParams.set('lon', '85.3096');
    endpoint.searchParams.set('limit', '8');
    endpoint.searchParams.set('lang', 'en');

    const response = await fetch(endpoint, {
      headers: {
        accept: 'application/json',
        'user-agent': 'EventPointRanchi/1.0 (https://eventpointranchi.com; planning map search)',
      },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return [];
    const results = mapPhotonPlaces(await response.json(), query);
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, results });
    if (cache.size > 200) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return results;
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ url }) => {
  const query = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (query.length < 2) {
    return json({ suggestions: popularRanchiPlaces(8) });
  }

  const local = searchRanchiPlaces(query, 8);
  const mapped = await mapSuggestions(query);
  return json({ suggestions: mergeVenueSuggestions(local, mapped, 10) });
};
