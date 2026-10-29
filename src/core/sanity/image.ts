import { createImageUrlBuilder } from '@sanity/image-url';
import type { SanityImageSource } from '@sanity/image-url';
import { getSanityConfig, isSanityConfigured } from './config';
import type { SanityImageReference } from './types';

let cachedBuilder: ReturnType<typeof createImageUrlBuilder> | null = null;

function getBuilder() {
  if (!cachedBuilder && isSanityConfigured()) {
    const config = getSanityConfig();
    cachedBuilder = createImageUrlBuilder({
      projectId: config.projectId,
      dataset: config.dataset,
    });
  }
  return cachedBuilder;
}

/**
 * Resolves an image value to a usable URL.
 * Supports:
 * - Direct strings (Filebase /storage/... paths, local /images/..., or external URLs)
 * - Custom Sanity objects with `filebaseUrl`
 * - Standard Sanity image asset references via @sanity/image-url
 * - Fallbacks
 */
export function resolveSanityImage(
  imageSource: SanityImageReference | string | null | undefined,
  fallback = '/images/placeholder.jpg',
): string {
  if (!imageSource) return fallback;

  if (typeof imageSource === 'string') {
    const trimmed = imageSource.trim();
    return trimmed || fallback;
  }

  // Prioritize direct Filebase URL if attached in Sanity
  if (imageSource.filebaseUrl && typeof imageSource.filebaseUrl === 'string') {
    const trimmed = imageSource.filebaseUrl.trim();
    if (trimmed) return trimmed;
  }

  // If a direct asset URL exists
  if (imageSource.asset?.url) {
    return imageSource.asset.url;
  }

  // If standard Sanity asset reference exists and Sanity is configured
  if (imageSource.asset?._ref) {
    const builder = getBuilder();
    if (builder) {
      try {
        return builder.image(imageSource as SanityImageSource).auto('format').fit('max').url();
      } catch {
        return fallback;
      }
    }
  }

  return fallback;
}
