import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RANCHI_PLACES, popularRanchiPlaces, searchRanchiPlaces } from '../src/core/venues/ranchi';

test('finds a locality from a prefix', () => {
  const results = searchRanchiPlaces('har');
  assert.ok(results.length > 0);
  assert.equal(results[0].name, 'Harmu');
});

test('tolerates a typo of up to two edits', () => {
  const names = searchRanchiPlaces('hrmu').map((r) => r.name);
  assert.ok(names.includes('Harmu'), `expected Harmu, got ${names.join(', ')}`);
});

test('matches through an alias', () => {
  const names = searchRanchiPlaces('radisson').map((r) => r.name);
  assert.ok(names.includes('Hotel Radisson Blu'));
});

test('matches multi-word queries by word prefix', () => {
  const names = searchRanchiPlaces('ranchi club').map((r) => r.name);
  assert.ok(names.includes('Ranchi Club'));
});

test('returns nothing for a query that is too short or unrelated', () => {
  assert.deepEqual(searchRanchiPlaces('h'), []);
  assert.deepEqual(searchRanchiPlaces('zzzzqqq'), []);
});

test('caps results and never mutates the dataset', () => {
  const size = RANCHI_PLACES.length;
  assert.ok(searchRanchiPlaces('r', 6).length <= 6);
  assert.ok(searchRanchiPlaces('road', 6).length <= 6);
  assert.equal(RANCHI_PLACES.length, size);
});

test('every entry has a unique name', () => {
  const names = RANCHI_PLACES.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('provides a bounded starting list for an empty venue field', () => {
  const popular = popularRanchiPlaces(8);
  assert.equal(popular.length, 8);
  assert.equal(popular[0].name, 'Harmu');
});
