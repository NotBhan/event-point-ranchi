import { all, one } from '../../core/db';
import { buildPagination } from '../../core/http';
import { loadPageSettings } from '../halls/service';

export interface GalleryPageData {
  settings: ReturnType<typeof loadPageSettings>;
  categories: Array<{ id: number; name: string; slug: string; count: number }>;
  items: Array<{ id: number; title: string; image: string; category_id: number; category_name: string; category_slug: string }>;
  category: string;
  perPage: number;
  pagination: ReturnType<typeof buildPagination>;
}

export const GALLERY_PER_PAGE_OPTIONS = [12, 24, 48] as const;
export const GALLERY_DEFAULT_PER_PAGE = 24;

export function loadGalleryPage(options: { category?: string; page?: number; perPage?: number } = {}): GalleryPageData {
  const settings = loadPageSettings('gallery', {
    hero_title: 'Moments At Event Point Ranchi',
    hero_subtitle: 'Mandap details, stage settings and celebrations styled by our Ranchi team.',
    hero_badge: 'The collection',
    hero_image: null,
  });

  const categories = all<{ id: number; name: string; slug: string; count: number }>(
    `SELECT gc.id, gc.name, gc.slug, COUNT(gi.id) AS count
     FROM gallery_categories gc
     LEFT JOIN gallery_items gi ON gi.category_id = gc.id AND gi.is_active = 1
     WHERE gc.is_active = 1
     GROUP BY gc.id
     ORDER BY gc.sort, gc.name`,
  );

  const requestedPerPage = Number(options.perPage);
  const perPage = (GALLERY_PER_PAGE_OPTIONS as readonly number[]).includes(requestedPerPage)
    ? requestedPerPage
    : GALLERY_DEFAULT_PER_PAGE;
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1) || 1);

  const validCategory = (options.category ?? '').trim();
  const category = validCategory && categories.some((entry) => entry.slug === validCategory) ? validCategory : '';

  // Server-side pagination: previously every gallery item was rendered into
  // the HTML and filtered/paginated client-side.
  const categoryFilter = category ? 'AND gc.slug = ?' : '';
  const filterParams = category ? [category] : [];

  const totalRow = one<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM gallery_items gi
     JOIN gallery_categories gc ON gc.id = gi.category_id
     WHERE gi.is_active = 1 AND gc.is_active = 1 ${categoryFilter}`,
    filterParams,
  );
  const totalCount = Number(totalRow?.count ?? 0);
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = all<{ id: number; title: string; image: string; category_id: number; category_name: string; category_slug: string }>(
    `SELECT gi.id, gi.title, gi.image, gi.category_id, gc.name AS category_name, gc.slug AS category_slug
     FROM gallery_items gi
     JOIN gallery_categories gc ON gc.id = gi.category_id
     WHERE gi.is_active = 1 AND gc.is_active = 1 ${categoryFilter}
     ORDER BY gi.created_at DESC, gi.id DESC
     LIMIT ? OFFSET ?`,
    [...filterParams, perPage, offset],
  );

  return {
    settings,
    categories,
    items,
    category,
    perPage,
    pagination: buildPagination(requestedPage, perPage, totalCount, items.length),
  };
}
