import type { CartMenuItem } from './cart';

export interface PlanMenuSection {
  id: string;
  title: string;
  maxSelection: number;
  items: Array<{ id: string; name: string }>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function itemEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The Plan catalogue can receive either normalized D1 sections
 * (`section.items`) or the older `menu_sections_json` shape. Normalize both
 * into one immutable structure so the menu dialog and tests share the rules.
 */
export function normalisePlanMenuSections(raw: unknown): PlanMenuSection[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const section = entry as Record<string, any>;
    const categories = itemEntries(section.categories);
    const sourceItems = Array.isArray(section.items) && section.items.length > 0
      ? section.items
      : categories.flatMap((category) => itemEntries((category as any)?.items));

    const seen = new Set<string>();
    const items = sourceItems.flatMap((entryItem) => {
      const name = typeof entryItem === 'string'
        ? entryItem.trim()
        : text((entryItem as any)?.name ?? (entryItem as any)?.item);
      if (!name || seen.has(name.toLowerCase())) return [];
      seen.add(name.toLowerCase());
      return [{
        id: String((entryItem as any)?.id ?? name),
        name,
      }];
    });

    const title = text(section.title ?? section.name) || `Menu section ${index + 1}`;
    const maxSelection = Math.max(0, Math.floor(Number(section.max_selection ?? section.maxSelection ?? 0) || 0));
    if (items.length === 0) return [];

    return [{
      id: String(section.id ?? title),
      title,
      maxSelection,
      items,
    }];
  });
}

/** The package's default selection: up to each section's limit, or all items. */
export function defaultPlanMenuItems(sections: PlanMenuSection[]): CartMenuItem[] {
  return sections.flatMap((section) => {
    const limit = section.maxSelection > 0 ? section.maxSelection : section.items.length;
    return section.items.slice(0, limit).map((item) => ({
      section: section.title,
      item: item.name,
    }));
  });
}

export function planMenuItemsPreview(items: CartMenuItem[], limit = 3): string {
  const names = items.map((item) => item.item).filter(Boolean);
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} +${names.length - limit} more`;
}
