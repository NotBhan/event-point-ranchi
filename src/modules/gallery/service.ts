import { buildPagination } from '../../core/http';
import { getGalleryCatalog } from '../../core/content/service';

export interface GalleryPageSettings {
  hero_title: string;
  hero_subtitle: string;
  hero_badge: string;
  hero_image: string | null;
}

export interface GalleryPageData {
  settings: GalleryPageSettings;
  categories: Array<{ id: number; name: string; slug: string; count: number }>;
  items: Array<{ id: number; title: string; image: string; category_id: number; category_name: string; category_slug: string }>;
  category: string;
  perPage: number;
  pagination: ReturnType<typeof buildPagination>;
}

export const GALLERY_PER_PAGE_OPTIONS = [12, 24, 48] as const;
export const GALLERY_DEFAULT_PER_PAGE = 24;

// Fallback hero copy only; the admin-editable D1 page content takes precedence.
const DEFAULT_SETTINGS: GalleryPageSettings = {
  hero_title: 'Moments At Event Point Ranchi',
  hero_subtitle: 'Mandap details, stage settings and celebrations styled by our Ranchi team.',
  hero_badge: 'The collection',
  hero_image: null,
};

export async function loadGalleryPage(
  options: { category?: string; page?: number; perPage?: number } = {},
): Promise<GalleryPageData> {
  const catalog = await getGalleryCatalog();

  const categories = catalog.categories
    .filter((category) => category.is_visible)
    .map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      count: catalog.items.filter((item) => item.category_id === category.id).length,
    }));

  const requestedPerPage = Number(options.perPage);
  const perPage = (GALLERY_PER_PAGE_OPTIONS as readonly number[]).includes(requestedPerPage)
    ? requestedPerPage
    : GALLERY_DEFAULT_PER_PAGE;
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1) || 1);

  const validCategory = (options.category ?? '').trim();
  const category = validCategory && categories.some((entry) => entry.slug === validCategory) ? validCategory : '';

  // Server-side pagination over the snapshot catalogue: the page ships only the
  // current slice, never the whole gallery.
  const visibleItems = catalog.items.filter(
    (item) => item.is_visible && (!category || item.category_slug === category),
  );
  const totalCount = visibleItems.length;
  const offset = buildPagination(requestedPage, perPage, totalCount, 0).offset;

  const items = visibleItems.slice(offset, offset + perPage).map((item) => ({
    id: item.id,
    title: item.caption,
    image: item.image_url,
    category_id: item.category_id,
    category_name: item.category_name,
    category_slug: item.category_slug,
  }));

  return {
    settings: DEFAULT_SETTINGS,
    categories,
    items,
    category,
    perPage,
    pagination: buildPagination(requestedPage, perPage, totalCount, items.length),
  };
}
