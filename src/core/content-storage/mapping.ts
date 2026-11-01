/**
 * Builds storage documents from the values the site currently renders.
 *
 * This module is used by the migration/export tooling only. It imports *types*
 * from the content service (erased at runtime) so there is no runtime dependency
 * from the new storage layer back into the D1 service.
 */
import type {
  MergedHomepageContent,
  MergedSiteSettings,
  PageContent,
  ServiceItem,
  HomepageSection,
} from '../content/types';
import { resolveApprovedTagline } from './branding';
import {
  DEFAULT_ROBOTS,
  PAGE_PATHS,
  type ContentDocument,
  type PageDocument,
  type SiteDocument,
} from './schema';

export const SITE_PAGE_IDS = ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'] as const;
export type SitePageId = (typeof SITE_PAGE_IDS)[number];

export function isSitePageId(value: string): value is SitePageId {
  return (SITE_PAGE_IDS as readonly string[]).includes(value);
}

export interface D1ContentSnapshot {
  settings: MergedSiteSettings;
  pages: Record<string, PageContent>;
  homepage: MergedHomepageContent;
  services: ServiceItem[];
  /** Absolute or relative canonical per page, copied from `seo_settings`. */
  canonicals?: Record<string, string>;
}

function homepageSectionRows(homepage: MergedHomepageContent): HomepageSection[] {
  const row = (key: string, type: string, fields: Partial<HomepageSection>): HomepageSection => ({
    id: key,
    section_key: key,
    section_type: type,
    title: '',
    subtitle: '',
    description: '',
    image_url: '',
    cta_label: '',
    cta_url: '',
    badge: '',
    is_visible: 1,
    sort_order: 0,
    config_json: '{}',
    created_at: '',
    updated_at: '',
    ...fields,
  });

  const promo = homepage.promotionalBanner;
  return [
    row('hero', 'hero', {
      title: homepage.heroHeading,
      subtitle: homepage.heroSubtitle,
      image_url: homepage.heroImage,
      cta_label: homepage.primaryCta.label,
      cta_url: homepage.primaryCta.url,
      config_json: JSON.stringify({ secondaryCta: homepage.secondaryCta }),
      sort_order: 0,
    }),
    row('features', 'features', {
      config_json: JSON.stringify(homepage.features),
      sort_order: 1,
    }),
    row('steps', 'steps', {
      config_json: JSON.stringify(homepage.steps),
      sort_order: 2,
    }),
    row('promo_banner', 'promo', {
      badge: promo?.badge ?? '',
      title: promo?.headline ?? '',
      description: promo?.description ?? '',
      cta_label: promo?.ctaLabel ?? '',
      cta_url: promo?.ctaUrl ?? '',
      is_visible: promo?.enabled ? 1 : 0,
      sort_order: 3,
    }),
  ];
}

function pageDocumentFromContent(
  pageId: SitePageId,
  page: PageContent,
  canonicalUrl: string | undefined,
  meta: { contentVersion: number; updatedAt: string; updatedBy: string },
): PageDocument {
  const path = PAGE_PATHS[pageId];
  const config = (page.content_json ?? {}) as Record<string, unknown>;

  return {
    schemaVersion: 1,
    pageId,
    path,
    contentVersion: meta.contentVersion,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
    title: page.title,
    subtitle: page.subtitle,
    description: page.description,
    seo: {
      title: page.seo_title || page.title,
      metaTitle: page.seo_title || page.title,
      metaDescription: page.seo_description || page.subtitle,
      canonicalUrl: canonicalUrl ?? path,
      robots: DEFAULT_ROBOTS,
      ogTitle: page.seo_title || page.title,
      ogDescription: page.seo_description || page.subtitle,
      ogImage: page.og_image_url || '',
    },
    sections: Array.isArray(config.sections) ? (config.sections as PageDocument['sections']) : [],
    config: {
      ...config,
      bannerImageUrl: page.banner_image_url,
      bannerEnabled: page.banner_enabled,
    },
  };
}

/** Builds the full document set from the values the site currently renders. */
export function documentsFromSnapshot(
  snapshot: D1ContentSnapshot,
  meta: { updatedAt: string; updatedBy: string; contentVersion?: number },
): ContentDocument[] {
  const contentVersion = meta.contentVersion ?? 1;

  const siteDocument: SiteDocument = {
    schemaVersion: 1,
    pageId: 'site',
    path: PAGE_PATHS.site,
    contentVersion,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
    settings: {
      name: snapshot.settings.name,
      legalName: snapshot.settings.legalName,
      tagline: resolveApprovedTagline(snapshot.settings.tagline).value,
      shortDescription: snapshot.settings.shortDescription,
      logo: snapshot.settings.logo,
      favicon: snapshot.settings.favicon,
      phone: snapshot.settings.phone,
      whatsapp: snapshot.settings.whatsapp,
      email: snapshot.settings.email,
      address: snapshot.settings.address,
      venueAddress: snapshot.settings.venueAddress,
      businessHours: snapshot.settings.businessHours,
      googleMapsUrl: snapshot.settings.googleMapsUrl,
      latitude: snapshot.settings.latitude,
      longitude: snapshot.settings.longitude,
      footerText: snapshot.settings.footerText,
      contactButtonsEnabled: snapshot.settings.contactButtonsEnabled,
      social: snapshot.settings.social.map((link) => ({ label: link.label, href: link.href })),
      theme: { ...snapshot.settings.theme },
      seo: { ...snapshot.settings.seo },
    },
    homepageSections: homepageSectionRows(snapshot.homepage).map((section, index) => ({
      sectionKey: section.section_key,
      sectionType: section.section_type,
      title: section.title,
      subtitle: section.subtitle,
      description: section.description,
      imageUrl: section.image_url,
      ctaLabel: section.cta_label,
      ctaUrl: section.cta_url,
      badge: section.badge,
      isVisible: Boolean(section.is_visible),
      sortOrder: section.sort_order ?? index,
      config: JSON.parse(section.config_json || '{}'),
    })),
    services: snapshot.services.map((service, index) => ({
      slug: service.slug,
      title: service.title,
      description: service.description,
      badge: service.badge,
      imageUrl: service.image_url,
      features: service.features,
      isVisible: service.is_visible,
      sortOrder: service.sort_order ?? index,
    })),
  };

  const pages = SITE_PAGE_IDS.map((pageId) => {
    const page = snapshot.pages[pageId];
    if (!page) throw new Error(`Snapshot is missing page "${pageId}"`);
    return pageDocumentFromContent(pageId, page, snapshot.canonicals?.[pageId], { ...meta, contentVersion });
  });

  return [siteDocument, ...pages];
}
