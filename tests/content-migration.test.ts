import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDocuments } from './helpers/content-fixtures';
import { documentsFromSnapshot, SITE_PAGE_IDS } from '../src/core/content-storage/mapping';
import { validatePublicationDocuments } from '../src/core/content-storage/schema';
import type { MergedHomepageContent, MergedSiteSettings, PageContent, ServiceItem } from '../src/core/content/types';

function page(pageKey: string): PageContent {
  return {
    id: 0,
    page_key: pageKey,
    title: `${pageKey} heading`,
    subtitle: `${pageKey} subheading`,
    description: `${pageKey} description`,
    banner_image_url: `/storage/assets/banners/${pageKey}/banner-hero.webp`,
    banner_enabled: true,
    content_json: { badge: `${pageKey} badge`, chips: [{ icon: 'chair', text: 'x' }] },
    seo_title: `${pageKey} seo title`,
    seo_description: `${pageKey} seo description`,
    og_image_url: `/storage/assets/banners/${pageKey}/banner-hero.webp`,
    published: true,
    created_at: '',
    updated_at: '',
  };
}

const settings: MergedSiteSettings = {
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
  seo: { defaultTitle: 'Default title', defaultDescription: 'Default description', ogImage: '/og.webp' },
};

const homepage: MergedHomepageContent = {
  heroHeading: 'Hero',
  heroSubtitle: 'Hero subtitle',
  heroImage: '/hero.webp',
  primaryCta: { label: 'Explore', url: '/mandaps' },
  secondaryCta: { label: 'Plan', url: '/plan' },
  announcementBar: { enabled: true, text: 'Announcement', location: 'Ranchi', phone: '+91 98765 43210' },
  features: [{ icon: 'archway', title: 'Feature', description: 'Feature description' }],
  steps: [{ stepNumber: '01', title: 'Step', description: 'Step description' }],
  sectionsVisibility: { mandaps: true, stages: true, equipment: true, catering: true, gallery: true, stats: true },
  promotionalBanner: {
    enabled: true,
    badge: 'Offer',
    headline: 'Headline',
    description: 'Description',
    ctaLabel: 'Learn',
    ctaUrl: '/plan',
  },
};

const services: ServiceItem[] = [
  {
    id: 1,
    slug: 'mandaps',
    title: 'Mandaps',
    description: 'Signature mandaps',
    badge: 'Popular',
    image_url: '/mandap.webp',
    features: ['Carved'],
    is_visible: true,
    sort_order: 0,
  },
];

test('the exporter builds one document per page plus a site document', () => {
  const pages = Object.fromEntries(SITE_PAGE_IDS.map((pageId) => [pageId, page(pageId)]));
  const documents = documentsFromSnapshot(
    { settings, pages, homepage, services },
    { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'migration', contentVersion: 1 },
  );

  assert.equal(documents.length, 7);
  const ids = documents.map((document) => document.pageId).sort();
  assert.deepEqual(ids, ['catering', 'equipment', 'gallery', 'home', 'mandaps', 'site', 'stages']);

  // Every document passes the same validator the publisher uses.
  assert.doesNotThrow(() => validatePublicationDocuments(documents));
});

test('the exporter preserves page text, SEO and page configuration', () => {
  const pages = Object.fromEntries(SITE_PAGE_IDS.map((pageId) => [pageId, page(pageId)]));
  const documents = documentsFromSnapshot(
    { settings, pages, homepage, services },
    { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'migration' },
  );

  const home = documents.find((document) => document.pageId === 'home');
  assert.ok(home && home.pageId === 'home');
  assert.equal(home!.title, 'home heading');
  assert.equal(home!.subtitle, 'home subheading');
  assert.equal(home!.seo.metaTitle, 'home seo title');
  assert.equal(home!.seo.metaDescription, 'home seo description');
  assert.equal(home!.seo.canonicalUrl, '/');
  assert.equal(home!.seo.robots, 'index,follow');
  assert.equal(home!.config.badge, 'home badge');
  assert.equal(home!.config.bannerImageUrl, '/storage/assets/banners/home/banner-hero.webp');
});

test('the site document carries brand, homepage sections and services', () => {
  const pages = Object.fromEntries(SITE_PAGE_IDS.map((pageId) => [pageId, page(pageId)]));
  const documents = documentsFromSnapshot(
    { settings, pages, homepage, services },
    { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'migration' },
  );

  const site = documents.find((document) => document.pageId === 'site');
  assert.ok(site && site.pageId === 'site');
  assert.equal(site!.settings.name, 'Event Point Ranchi');
  assert.equal(site!.settings.social[0].href, 'https://instagram.com/example');
  assert.equal(site!.settings.theme.primaryColor, '#721224');
  assert.equal(site!.homepageSections.length, 4);
  assert.equal(site!.homepageSections[0].sectionKey, 'hero');
  assert.equal(site!.homepageSections[0].title, 'Hero');
  assert.equal(site!.services[0].slug, 'mandaps');
});

test('an empty page set is rejected rather than publishing a partial site', () => {
  const documents = makeDocuments();
  assert.throws(
    () => validatePublicationDocuments(documents.filter((document) => document.pageId !== 'stages')),
    /incomplete/,
  );
});

test('a canonical that disagrees with the route is rejected', () => {
  const pages = Object.fromEntries(SITE_PAGE_IDS.map((pageId) => [pageId, page(pageId)]));
  const documents = documentsFromSnapshot(
    { settings, pages, homepage, services },
    { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'migration' },
  );

  const home = documents.find((document) => document.pageId === 'home');
  assert.ok(home && home.pageId === 'home');
  home!.seo.canonicalUrl = '/wrong';
  assert.throws(() => validatePublicationDocuments(documents), /must resolve to the page path/);
});

test('a seed tagline is replaced by the approved repository value', () => {
  const pages = Object.fromEntries(SITE_PAGE_IDS.map((pageId) => [pageId, page(pageId)]));
  const documents = documentsFromSnapshot(
    { settings: { ...settings, tagline: 'Premier Test Wedding Decorators - 1793530800710' }, pages, homepage, services },
    { updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'migration' },
  );

  const site = documents.find((document) => document.pageId === 'site');
  assert.ok(site && site.pageId === 'site');
  assert.equal(site!.settings.tagline, 'Wedding Mandap, Stage Designs, Furniture & Event Equipment Planning');
  assert.doesNotMatch(site!.settings.tagline, /test|1793530800710/i);
});

test('a document carrying the seed placeholder cannot be published', () => {
  const document = makeDocuments().find((entry) => entry.pageId === 'site');
  assert.ok(document && document.pageId === 'site');
  if (!document || document.pageId !== 'site') return;

  document.settings.tagline = 'Premier Test Wedding Decorators - 1793530800710';
  assert.throws(() => validatePublicationDocuments(makeDocuments().map((entry) => (entry.pageId === 'site' ? document : entry))), /seed placeholder/);
});

test('the approved tagline itself passes validation', () => {
  assert.doesNotThrow(() => validatePublicationDocuments(makeDocuments()));
});
