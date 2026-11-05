import assert from 'node:assert/strict';
import { test } from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

const session = new MemoryStorage();
(globalThis as any).sessionStorage = session;
(globalThis as any).localStorage = new MemoryStorage();

const cart = await import('../src/client/cart');
const { groupCateringItems, readCateringHandoff, summariseCateringItems } = await import(
  '../src/client/catering-handoff'
);

test('a catering package built on the detail page is handed to Plan with menu choices', () => {
  cart.setCatering({
    id: '7',
    name: 'Royal Shahi Feast',
    guestCount: 250,
    pricePerPlate: 185000,
    selectedItems: [
      { section: 'Starters', item: 'Paneer Tikka' },
      { section: 'Starters', item: 'Dahi Ke Kebab' },
      { section: 'Mains', item: 'Dal Makhani' },
    ],
    total: 46250000,
  });

  const handoff = readCateringHandoff();
  assert.deepEqual(handoff, {
    id: '7',
    name: 'Royal Shahi Feast',
    guestCount: 250,
    pricePerPlate: 185000,
    selectedItems: [
      { section: 'Starters', item: 'Paneer Tikka' },
      { section: 'Starters', item: 'Dahi Ke Kebab' },
      { section: 'Mains', item: 'Dal Makhani' },
    ],
  });
  assert.deepEqual(groupCateringItems(handoff!.selectedItems), [
    { section: 'Starters', items: ['Paneer Tikka', 'Dahi Ke Kebab'] },
    { section: 'Mains', items: ['Dal Makhani'] },
  ]);
  assert.equal(
    summariseCateringItems(handoff!.selectedItems),
    'Starters: Paneer Tikka, Dahi Ke Kebab · Mains: Dal Makhani',
  );
});

test('an empty cart has no Plan handoff', () => {
  cart.clearCart();
  assert.equal(readCateringHandoff(), null);
});
