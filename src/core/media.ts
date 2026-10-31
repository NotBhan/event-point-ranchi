import { imageUrl } from './http';

// Only same-origin stored assets and public images can be transformed by the
// /storage route; everything else (external CDNs, data URLs) is passed through.
const TRANSFORMABLE_PREFIXES = ['/storage/', '/images/'];

export interface ResponsiveImage {
  src: string;
  srcset?: string;
  sizes?: string;
}

export function withWidth(url: string, width: number): string {
  if (!TRANSFORMABLE_PREFIXES.some((prefix) => url.startsWith(prefix))) return url;
  if (/\.svg(\?|$)/i.test(url) || url.includes('?')) return url;
  return `${url}?w=${width}`;
}

export function responsiveImage(
  path: string | null | undefined,
  options: { widths?: number[]; sizes?: string; fallback?: string } = {},
): ResponsiveImage {
  const src = imageUrl(path, options.fallback);
  const widths = options.widths ?? [];
  if (widths.length === 0) return { src };

  const candidates = widths.map((width) => `${withWidth(src, width)} ${width}w`);
  const transformable = candidates.some((candidate, index) => candidate !== `${src} ${widths[index]}w`);
  if (!transformable) return { src };

  return { src, srcset: candidates.join(', '), sizes: options.sizes };
}

/** Thumbnail URL for admin lists (small boxes rendering large originals). */
export function thumbnailUrl(path: string | null | undefined, width = 96): string {
  return withWidth(imageUrl(path), width);
}

/** Hero/banner images: full-bleed width, priority-loaded. */
export function heroImage(path: string | null | undefined): ResponsiveImage {
  return responsiveImage(path, { widths: [800, 1200, 1600], sizes: '100vw' });
}
