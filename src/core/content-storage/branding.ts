/**
 * Branding values that must never reach a publication as seed placeholders.
 *
 * Production D1 currently holds
 *   site_settings.tagline = "Premier Test Wedding Decorators - 1793530800710"
 * which is seed output, not business copy. The approved value already exists in
 * the repository (`src/core/config.ts`), so the exporter substitutes it and the
 * validator refuses to publish the placeholder.
 */
import { site } from '../config';

export const APPROVED_TAGLINE = site.tagline;

/** Recognises the known seed shapes without rejecting legitimate prose. */
export function isPlaceholderTagline(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length === 0) return false;

  // The exact seed phrase, in any casing.
  if (/premier\s+test\s+wedding\s+decorators/i.test(text)) return true;

  // Seed rows append a millisecond timestamp, e.g. "… Decorators - 1793530800710".
  if (/\s-\s\d{10,}$/.test(text)) return true;

  return false;
}

export interface TaglineResolution {
  value: string;
  substituted: boolean;
  reason?: string;
}

/**
 * Returns the approved tagline when the source value is a seed placeholder.
 * Any other value (including an empty one) is preserved verbatim — the exporter
 * never invents brand copy.
 */
export function resolveApprovedTagline(value: unknown): TaglineResolution {
  if (isPlaceholderTagline(value)) {
    return {
      value: APPROVED_TAGLINE,
      substituted: true,
      reason: 'source tagline is a seed placeholder; substituted the approved repository value',
    };
  }
  return { value: typeof value === 'string' ? value : '', substituted: false };
}
