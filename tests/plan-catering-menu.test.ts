import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPlanMenuItems,
  normalisePlanMenuSections,
  planMenuItemsPreview,
} from '../src/client/plan-catering';

test('normalises normalized D1 menu sections and applies section limits', () => {
  const sections = normalisePlanMenuSections([
    {
      id: 1,
      title: 'Starters',
      max_selection: 2,
      items: [
        { id: 11, name: 'Paneer Tikka' },
        { id: 12, name: 'Chicken Kebab' },
        { id: 13, name: 'Veg Spring Roll' },
      ],
    },
  ]);

  assert.deepEqual(defaultPlanMenuItems(sections), [
    { section: 'Starters', item: 'Paneer Tikka' },
    { section: 'Starters', item: 'Chicken Kebab' },
  ]);
  assert.equal(planMenuItemsPreview(defaultPlanMenuItems(sections)), 'Paneer Tikka, Chicken Kebab');
});

test('normalises legacy category and string menu shapes without mutation', () => {
  const input = [
    {
      name: 'Desserts',
      maxSelection: 0,
      categories: [{ items: [{ name: 'Gulab Jamun' }, 'Rasmalai'] }],
    },
  ];
  const before = JSON.stringify(input);
  const sections = normalisePlanMenuSections(input);

  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(sections[0].items.map((item) => item.name), ['Gulab Jamun', 'Rasmalai']);
  assert.equal(sections[0].maxSelection, 0);
  assert.deepEqual(defaultPlanMenuItems(sections), [
    { section: 'Desserts', item: 'Gulab Jamun' },
    { section: 'Desserts', item: 'Rasmalai' },
  ]);
});

test('drops malformed and duplicate menu entries', () => {
  const sections = normalisePlanMenuSections([
    null,
    { title: 'Empty', items: [] },
    { title: 'Mains', items: [{ name: 'Biryani' }, { name: 'biryani' }, ''] },
  ]);

  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].items, [{ id: 'Biryani', name: 'Biryani' }]);
  assert.equal(planMenuItemsPreview([], 3), '');
});
