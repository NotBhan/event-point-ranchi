import { venueMatchScore, type VenueSuggestion } from './ranchi';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

const AREA_TYPES = new Set([
  'city',
  'town',
  'village',
  'suburb',
  'neighbourhood',
  'locality',
  'hamlet',
  'quarter',
  'district',
]);

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maps Photon/OpenStreetMap results into the same suggestion shape as the local list. */
export function mapPhotonPlaces(payload: unknown, query = ''): VenueSuggestion[] {
  const features = Array.isArray((payload as { features?: unknown })?.features)
    ? ((payload as { features: PhotonFeature[] }).features)
    : [];
  const seen = new Set<string>();
  const results: VenueSuggestion[] = [];

  for (const feature of features) {
    const properties = feature?.properties ?? {};
    if (properties.countrycode && properties.countrycode !== 'IN') continue;

    const coordinates = feature?.geometry?.coordinates;
    const lon = Number(coordinates?.[0]);
    const lat = Number(coordinates?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (lat < 22.9 || lat > 23.8 || lon < 84.7 || lon > 85.9) continue;
    }

    const name = String(properties.name || properties.street || '').trim();
    if (!name) continue;
    const city = String(properties.city || '').trim();
    const label = city && normalise(city) !== normalise(name) ? `${name}, ${city}` : name;
    const key = normalise(label);
    if (!key || seen.has(key)) continue;
    if (query && venueMatchScore(query, label) < 35) continue;
    seen.add(key);

    const osmValue = String(properties.osm_value || '').toLowerCase();
    results.push({
      name: label,
      kind: AREA_TYPES.has(osmValue) ? 'area' : 'venue',
      score: 45,
    });
    if (results.length >= 8) break;
  }

  return results;
}

/** Local fuzzy matches stay first; map results add venues the curated list may miss. */
export function mergeVenueSuggestions(
  local: VenueSuggestion[],
  mapped: VenueSuggestion[],
  limit = 10,
): VenueSuggestion[] {
  const seen = new Set<string>();
  const merged: VenueSuggestion[] = [];
  for (const suggestion of [...local, ...mapped]) {
    const key = normalise(suggestion.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
    if (merged.length >= limit) break;
  }
  return merged;
}
