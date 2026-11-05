import { readCart, type CartMenuItem } from './cart';

export interface CateringHandoff {
  id: string;
  name: string;
  guestCount: number;
  pricePerPlate: number;
  selectedItems: CartMenuItem[];
}

/**
 * Reads a package built on the public catering detail page. The cart is scoped
 * to the current tab and is only a handoff into the Plan wizard, never a
 * pricing authority.
 */
export function readCateringHandoff(): CateringHandoff | null {
  const catering = readCart().catering;
  if (!catering) return null;

  const guestCount = Math.max(1, Number(catering.guestCount) || 1);
  const pricePerPlate = Math.max(0, Number(catering.pricePerPlate) || 0);
  const selectedItems = (catering.selectedItems ?? [])
    .map((item) => ({
      section: String(item.section ?? '').trim(),
      item: String(item.item ?? '').trim(),
    }))
    .filter((item) => item.section && item.item);

  return {
    id: String(catering.id),
    name: String(catering.name || 'Catering package'),
    guestCount,
    pricePerPlate,
    selectedItems,
  };
}

export function groupCateringItems(items: CartMenuItem[]): Array<{ section: string; items: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const section = item.section || 'Menu selections';
    const list = grouped.get(section) ?? [];
    list.push(item.item);
    grouped.set(section, list);
  }
  return Array.from(grouped.entries()).map(([section, entries]) => ({ section, items: entries }));
}

export function summariseCateringItems(items: CartMenuItem[]): string {
  return groupCateringItems(items)
    .map((entry) => `${entry.section}: ${entry.items.join(', ')}`)
    .join(' · ');
}
