/**
 * Curated Ranchi localities and venues for the planning form.
 *
 * Ranchi is the service area, so a local list is enough and avoids shipping a
 * geocoding API key to the browser. Suggestions only assist the customer: any
 * free-text venue is still accepted.
 */
export interface RanchiPlace {
  name: string;
  kind: 'area' | 'venue';
  aliases?: string[];
}

export const RANCHI_PLACES: RanchiPlace[] = [
  { name: 'Harmu', kind: 'area', aliases: ['harmu housing colony', 'harmu road'] },
  { name: 'Morabadi Grounds', kind: 'venue', aliases: ['morabadi', 'morhabadi ground'] },
  { name: 'Ranchi Club', kind: 'venue', aliases: ['ranchi club ltd'] },
  { name: 'Kanke Road', kind: 'area', aliases: ['kanke'] },
  { name: 'Lalpur', kind: 'area' },
  { name: 'Bariatu', kind: 'area', aliases: ['bariatu road'] },
  { name: 'Circular Road', kind: 'area', aliases: ['circular rd'] },
  { name: 'Hinoo', kind: 'area', aliases: ['hinoo colony'] },
  { name: 'Doranda', kind: 'area' },
  { name: 'Ratu Road', kind: 'area', aliases: ['ratu rd'] },
  { name: 'Khelgaon', kind: 'area', aliases: ['khel gaon'] },
  { name: 'Albert Ekka Chowk', kind: 'venue', aliases: ['albert ekka square', 'ekka chowk'] },
  { name: 'Hatia', kind: 'area', aliases: ['hatia railway colony'] },
  { name: 'Dhurwa', kind: 'area' },
  { name: 'Kokar', kind: 'area' },
  { name: 'Namkum', kind: 'area' },
  { name: 'Tupudana', kind: 'area' },
  { name: 'Ormanjhi', kind: 'area' },
  { name: 'Mandar', kind: 'area' },
  { name: 'Pithoria', kind: 'area' },
  { name: 'Chutia', kind: 'area' },
  { name: 'Kantatoli', kind: 'area' },
  { name: 'Upper Bazar', kind: 'area', aliases: ['upper bazaar'] },
  { name: 'Lower Bazar', kind: 'area', aliases: ['lower bazaar'] },
  { name: 'Main Road', kind: 'area', aliases: ['main road ranchi'] },
  { name: 'Station Road', kind: 'area' },
  { name: 'Sarjana Chowk', kind: 'area' },
  { name: 'Argora', kind: 'area' },
  { name: 'Ashok Nagar', kind: 'area' },
  { name: 'Vikas Nagar', kind: 'area' },
  { name: 'Boothnath', kind: 'area' },
  { name: 'Ratu', kind: 'area' },
  { name: 'Bero', kind: 'area' },
  { name: 'Sonahatu', kind: 'area' },
  { name: 'Silli', kind: 'area' },
  { name: 'Bundu', kind: 'area' },
  { name: 'Angara', kind: 'area' },
  { name: 'Sukhdeonagar', kind: 'area', aliases: ['sukhdee nagar'] },
  { name: 'Gandhi Nagar', kind: 'area' },
  { name: 'Pragati Path', kind: 'area' },
  { name: 'Lalpur Chowk', kind: 'venue' },
  { name: 'Firayalal Chowk', kind: 'venue', aliases: ['firayalal'] },
  { name: 'Suicide Point', kind: 'venue' },
  { name: 'Ranchi Lake', kind: 'venue', aliases: ['line tank pond'] },
  { name: 'Dassam Falls', kind: 'venue', aliases: ['dasam falls', 'dassam fall'] },
  { name: 'Hundru Falls', kind: 'venue', aliases: ['hundru fall'] },
  { name: 'Patratu Valley', kind: 'venue' },
  { name: 'Jonha Falls', kind: 'venue', aliases: ['gautamdhara'] },
  { name: 'Birsa Munda Airport', kind: 'venue', aliases: ['ranchi airport'] },
  { name: 'Ranchi Railway Station', kind: 'venue', aliases: ['ranchi station'] },
  { name: 'BIT Mesra', kind: 'venue', aliases: ['mesra', 'bits mesra'] },
  { name: 'IIT ISM Dhanbad Road', kind: 'area' },
  { name: 'RIMS', kind: 'venue', aliases: ['rims ranchi'] },
  { name: 'Rajendra Institute of Medical Sciences', kind: 'venue', aliases: ['rims'] },
  { name: 'St. Xaviers College', kind: 'venue', aliases: ['st xavier college'] },
  { name: 'Ranchi University', kind: 'venue' },
  { name: 'Hotel Radisson Blu', kind: 'venue', aliases: ['radisson', 'radisson blu ranchi'] },
  { name: 'Hotel Capitol Hill', kind: 'venue', aliases: ['capitol hill'] },
  { name: 'Hotel Chanakya', kind: 'venue', aliases: ['chanakya'] },
  { name: 'Hotel BNR Chanakya', kind: 'venue', aliases: ['bnr chanakya'] },
  { name: 'Hotel Arya', kind: 'venue' },
  { name: 'The Royal Retreat', kind: 'venue', aliases: ['royal retreat ranchi'] },
  { name: 'Chanakya BNR', kind: 'venue' },
  { name: 'Kanke Dam', kind: 'venue' },
  { name: 'Ranchi Science Centre', kind: 'venue', aliases: ['science center'] },
  { name: 'Tagore Hill', kind: 'venue', aliases: ['morabadi hill'] },
  { name: 'Ranchi Haat', kind: 'venue' },
  { name: 'Jagannath Temple', kind: 'venue', aliases: ['jagannath mandir'] },
  { name: 'Pahari Mandir', kind: 'venue', aliases: ['pahari temple'] },
  { name: 'Ranchi Mahila Samiti', kind: 'venue' },
  { name: 'Khelgaon Stadium', kind: 'venue', aliases: ['khel gaon stadium'] },
  { name: 'Harmu Maidan', kind: 'venue', aliases: ['harmu ground'] },
  { name: 'Bariatu Bungalow', kind: 'venue' },
  { name: 'Doranda Bungalow', kind: 'venue' },
  { name: 'Ratu Road Bungalow', kind: 'venue' },
];

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bounded Levenshtein distance; returns early once `max` is exceeded. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/** True when every character of `needle` appears in order in `haystack`. */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function score(query: string, candidate: string): number {
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 80;
  if (candidate.split(' ').some((word) => word.startsWith(query))) return 65;
  if (candidate.includes(query)) return 50;
  if (editDistance(query, candidate, 2) <= 2) return 35;
  if (isSubsequence(query, candidate)) return 20;
  return 0;
}

export interface VenueSuggestion {
  name: string;
  kind: RanchiPlace['kind'];
  score: number;
}

export function venueMatchScore(query: string, candidate: string): number {
  return score(normalise(query), normalise(candidate));
}

/** A short, curated starting list for an empty or focused venue field. */
export function popularRanchiPlaces(limit = 8): VenueSuggestion[] {
  return RANCHI_PLACES.slice(0, Math.max(0, limit)).map((place) => ({
    name: place.name,
    kind: place.kind,
    score: 0,
  }));
}

/**
 * Fuzzy search over Ranchi localities and venues.
 * Typo tolerance is intentionally short: two edits, so "hrmu" finds "Harmu"
 * but random strings do not.
 */
export function searchRanchiPlaces(query: string, limit = 6): VenueSuggestion[] {
  const normalised = normalise(query);
  if (normalised.length < 2) return [];

  const results: VenueSuggestion[] = [];
  for (const place of RANCHI_PLACES) {
    const candidates = [place.name, ...(place.aliases ?? [])].map(normalise);
    let best = 0;
    for (const candidate of candidates) {
      const value = score(normalised, candidate);
      if (value > best) best = value;
    }
    if (best > 0) results.push({ name: place.name, kind: place.kind, score: best });
  }

  return results
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
