/**
 * Builds the publication document set from the **live** D1 content.
 *
 * Shared by the migration CLI and the Content Studio "publish" action so the two
 * cannot drift. It only ever reads D1.
 */
import { getD1Client } from '../content/d1-client';
import { getHomepageContent, getPageContent, getServices, getSiteSettings } from '../content/service';
import { documentsFromSnapshot, SITE_PAGE_IDS } from './mapping';
import type { ContentDocument } from './schema';

export const HERO_IMAGE_FALLBACK = '/storage/assets/banners/homepage/banner-hero.webp';

/** D1 stores `YYYY-MM-DD HH:MM:SS`; normalise to ISO. */
function toIso(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  const iso = trimmed.includes('T') ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Newest `updated_at` across the source tables. Deriving the timestamp from the
 * data (rather than "now") keeps repeated exports byte-identical, which is what
 * makes the immutable upload idempotent.
 */
export async function deriveUpdatedAt(): Promise<string> {
  const d1 = getD1Client();
  const tables = ['page_content', 'seo_settings', 'site_settings', 'homepage_sections', 'services'];
  let newest = 0;

  for (const table of tables) {
    const res = await d1.query<{ latest: string | null }>(`SELECT MAX(updated_at) AS latest FROM ${table}`);
    const parsed = toIso(res.results[0]?.latest ?? null);
    if (parsed !== null && parsed > newest) newest = parsed;
  }

  return newest > 0 ? new Date(newest).toISOString() : new Date().toISOString();
}

export async function readCanonicals(): Promise<Record<string, string>> {
  const d1 = getD1Client();
  const res = await d1.query<{ page_key: string; canonical_url: string }>(
    'SELECT page_key, canonical_url FROM seo_settings',
  );
  const canonicals: Record<string, string> = {};
  for (const row of res.results) {
    if (row.page_key && row.canonical_url) canonicals[row.page_key] = row.canonical_url;
  }
  return canonicals;
}

export async function buildDocumentsFromD1(options: {
  updatedBy: string;
  contentVersion?: number;
  updatedAt?: string;
}): Promise<{ documents: ContentDocument[]; updatedAt: string }> {
  const [settings, homepage, services, canonicals, derivedUpdatedAt] = await Promise.all([
    getSiteSettings(true),
    getHomepageContent(HERO_IMAGE_FALLBACK, true),
    getServices(true),
    readCanonicals(),
    options.updatedAt ? Promise.resolve(options.updatedAt) : deriveUpdatedAt(),
  ]);

  const pages: Record<string, Awaited<ReturnType<typeof getPageContent>>> = {};
  for (const pageId of SITE_PAGE_IDS) {
    pages[pageId] = await getPageContent(pageId, true);
  }

  const updatedAt = options.updatedAt ?? derivedUpdatedAt;
  const documents = documentsFromSnapshot(
    { settings, pages, homepage, services, canonicals },
    { updatedAt, updatedBy: options.updatedBy, contentVersion: options.contentVersion ?? 1 },
  );

  return { documents, updatedAt };
}
