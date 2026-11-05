import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPhotonPlaces, mergeVenueSuggestions } from '../src/core/venues/map-search';

test('maps in-bounds Photon results and classifies areas', () => {
  const results = mapPhotonPlaces({
    features: [
      {
        geometry: { coordinates: [85.32, 23.35] },
        properties: {
          name: 'Harmu',
          city: 'Ranchi',
          state: 'Jharkhand',
          countrycode: 'IN',
          osm_key: 'place',
          osm_value: 'suburb',
        },
      },
      {
        geometry: { coordinates: [85.31, 23.37] },
        properties: {
          name: 'Ranchi Club',
          city: 'Ranchi',
          countrycode: 'IN',
          osm_key: 'leisure',
          osm_value: 'sports_centre',
        },
      },
    ],
  }, 'harmu');

  assert.deepEqual(results.map((entry) => entry.name), ['Harmu, Ranchi']);
  assert.equal(results[0].kind, 'area');
});

test('classifies a mapped venue and applies query relevance', () => {
  const results = mapPhotonPlaces({
    features: [{
      geometry: { coordinates: [85.31, 23.37] },
      properties: {
        name: 'Ranchi Club',
        city: 'Ranchi',
        countrycode: 'IN',
        osm_key: 'leisure',
        osm_value: 'sports_centre',
      },
    }],
  }, 'ranchi club');

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'venue');
});

test('drops foreign, out-of-area, duplicate and nameless map results', () => {
  const results = mapPhotonPlaces({
    features: [
      { properties: { name: 'Delhi', countrycode: 'IN' }, geometry: { coordinates: [77.2, 28.6] } },
      { properties: { name: 'London', countrycode: 'GB' }, geometry: { coordinates: [85.3, 23.3] } },
      { properties: { name: 'Harmu', countrycode: 'IN' }, geometry: { coordinates: [85.3, 23.3] } },
      { properties: { name: 'Harmu', countrycode: 'IN' }, geometry: { coordinates: [85.3, 23.3] } },
      { properties: { countrycode: 'IN' }, geometry: { coordinates: [85.3, 23.3] } },
    ],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Harmu');
});

test('merges local fuzzy results first without duplicates', () => {
  const merged = mergeVenueSuggestions(
    [{ name: 'Harmu', kind: 'area', score: 100 }],
    [
      { name: 'Harmu, Ranchi', kind: 'area', score: 45 },
      { name: 'Ranchi Club', kind: 'venue', score: 45 },
    ],
    2,
  );

  assert.deepEqual(merged.map((entry) => entry.name), ['Harmu', 'Harmu, Ranchi']);
});
