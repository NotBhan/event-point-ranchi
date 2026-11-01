/**
 * Fixtures for the content-storage suites. Everything here is in-memory: no
 * Filebase credentials and no Neon connection are used.
 */
import {
  PAGE_PATHS,
  type ContentDocument,
  type PageDocument,
  type SiteDocument,
  type SitePageId,
} from '../../src/core/content-storage/schema';
import { SITE_PAGE_IDS } from '../../src/core/content-storage/mapping';

export const UPDATED_AT = '2026-11-01T00:00:00.000Z';

export function makePageDocument(pageId: SitePageId, overrides: Partial<PageDocument> = {}): PageDocument {
  const path = PAGE_PATHS[pageId];
  return {
    schemaVersion: 1,
    pageId,
    path,
    contentVersion: 1,
    updatedAt: UPDATED_AT,
    updatedBy: 'test',
    title: `${pageId} title`,
    subtitle: `${pageId} subtitle`,
    description: `${pageId} description`,
    seo: {
      title: `${pageId} seo title`,
      metaTitle: `${pageId} meta title`,
      metaDescription: `${pageId} meta description`,
      canonicalUrl: path,
      robots: 'index,follow',
      ogTitle: `${pageId} og title`,
      ogDescription: `${pageId} og description`,
      ogImage: '/storage/assets/banners/homepage/banner-hero.webp',
    },
    sections: [{ id: 'intro', heading: `${pageId} heading`, subheading: '', description: '' }],
    config: { badge: `${pageId} badge` },
    ...overrides,
  };
}

export function makeSiteDocument(overrides: Partial<SiteDocument> = {}): SiteDocument {
  return {
    schemaVersion: 1,
    pageId: 'site',
    path: PAGE_PATHS.site,
    contentVersion: 1,
    updatedAt: UPDATED_AT,
    updatedBy: 'test',
    settings: {
      name: 'Event Point Ranchi',
      legalName: 'Event Point Ranchi',
      tagline: 'Wedding Mandap, Stage Designs, Furniture & Event Equipment Planning',
      shortDescription: 'Wedding planning in Ranchi.',
      logo: '/images/event-point-logo.svg',
      favicon: '/images/event-point-logo.svg',
      phone: '+91 98765 43210',
      whatsapp: '+91 98765 43210',
      email: 'info@example.test',
      address: 'Main Road, Ranchi',
      venueAddress: 'Main Road, Ranchi',
      businessHours: 'Daily, 10:00 – 19:00',
      googleMapsUrl: 'https://maps.google.com/?q=Ranchi',
      latitude: 23.3441,
      longitude: 85.3096,
      footerText: '',
      contactButtonsEnabled: true,
      social: [{ label: 'Instagram', href: 'https://instagram.com/example' }],
      theme: { primaryColor: '#721224', goldBright: '#e0b868', fontPreset: 'heritage' },
      seo: {
        defaultTitle: 'Event Point Ranchi | Wedding Mandaps',
        defaultDescription: 'Wedding planning in Ranchi.',
        ogImage: '/storage/assets/banners/homepage/banner-hero.webp',
      },
    },
    homepageSections: [
      {
        sectionKey: 'hero',
        sectionType: 'hero',
        title: 'Hero heading',
        subtitle: 'Hero subtitle',
        description: '',
        imageUrl: '/storage/assets/banners/homepage/banner-hero.webp',
        ctaLabel: 'Explore',
        ctaUrl: '/mandaps',
        badge: 'Wedding Planning',
        isVisible: true,
        sortOrder: 0,
        config: { secondaryCta: { label: 'Plan', url: '/plan' } },
      },
    ],
    services: [
      {
        slug: 'mandaps',
        title: 'Mandaps',
        description: 'Signature mandaps',
        badge: '',
        imageUrl: '',
        features: ['Carved', 'Floral'],
        isVisible: true,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

export function makeDocuments(contentVersion = 1): ContentDocument[] {
  return [
    makeSiteDocument({ contentVersion }),
    ...SITE_PAGE_IDS.map((pageId) => makePageDocument(pageId, { contentVersion })),
  ];
}
