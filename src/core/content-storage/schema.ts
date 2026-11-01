/**
 * Public page-content documents stored as immutable JSON objects in Filebase.
 *
 * This schema covers only the simple public content that used to live in the
 * D1 `page_content`, `seo_settings`, `homepage_sections`, `services` and
 * `site_settings` tables. Catalogue tables (mandaps, stages, equipment,
 * catering, gallery) stay in D1 and are not modelled here.
 *
 * Everything is plain text. There is no HTML field, so content cannot inject
 * markup into a rendered page.
 */

import { isPlaceholderTagline } from './branding';

export const CONTENT_SCHEMA_VERSION = 1;

/** Page ids the Content Studio may edit. Object keys derive from this list only. */
export const PAGE_IDS = ['site', 'home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'] as const;
export type PageId = (typeof PAGE_IDS)[number];
/** Page ids that have a public route; `site` holds site chrome instead. */
export type SitePageId = Exclude<PageId, 'site'>;

/**
 * Route for each document. `site` is site chrome (brand, contact, theme,
 * homepage sections, service tiles) and has no public route of its own, so it
 * gets a reserved path that can never collide with a real page.
 */
export const PAGE_PATHS: Record<PageId, string> = {
  site: '/__site',
  home: '/',
  mandaps: '/mandaps',
  stages: '/stages',
  equipment: '/equipment',
  gallery: '/gallery',
  catering: '/catering',
};

export const ALLOWED_ROBOTS = [
  'index,follow',
  'noindex,follow',
  'index,nofollow',
  'noindex,nofollow',
] as const;

export const DEFAULT_ROBOTS = 'index,follow';

export interface ContentSeo {
  title: string;
  metaTitle: string;
  metaDescription: string;
  /** Either the page route (e.g. `/mandaps`) or an absolute URL for it. */
  canonicalUrl: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
}

export interface ContentSection {
  id: string;
  heading: string;
  subheading: string;
  description: string;
}

export interface PageDocument {
  schemaVersion: number;
  pageId: SitePageId;
  path: string;
  contentVersion: number;
  updatedAt: string;
  updatedBy: string;
  title: string;
  subtitle: string;
  description: string;
  seo: ContentSeo;
  sections: ContentSection[];
  /** Page-level switches the current templates read (badge, chips, banner, …). */
  config: Record<string, unknown>;
}

export interface SiteLink {
  label: string;
  href: string;
}

export interface SiteSettingsContent {
  name: string;
  legalName: string;
  tagline: string;
  shortDescription: string;
  logo: string;
  favicon: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  venueAddress: string;
  businessHours: string;
  googleMapsUrl: string;
  latitude: number | null;
  longitude: number | null;
  footerText: string;
  contactButtonsEnabled: boolean;
  social: SiteLink[];
  theme: { primaryColor: string; goldBright: string; fontPreset: string };
  seo: { defaultTitle: string; defaultDescription: string; ogImage: string };
}

export interface HomepageSectionContent {
  sectionKey: string;
  sectionType: string;
  title: string;
  subtitle: string;
  description: string;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  badge: string;
  isVisible: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
}

export interface ServiceContent {
  slug: string;
  title: string;
  description: string;
  badge: string;
  imageUrl: string;
  features: string[];
  isVisible: boolean;
  sortOrder: number;
}

export interface SiteDocument {
  schemaVersion: number;
  pageId: 'site';
  path: string;
  contentVersion: number;
  updatedAt: string;
  updatedBy: string;
  settings: SiteSettingsContent;
  homepageSections: HomepageSectionContent[];
  services: ServiceContent[];
}

export type ContentDocument = PageDocument | SiteDocument;

export function isSiteDocument(document: ContentDocument): document is SiteDocument {
  return document.pageId === 'site';
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && (PAGE_IDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export class ContentValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Content validation failed: ${issues.join('; ')}`);
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}

interface FieldRule {
  max: number;
  required?: boolean;
}

const PAGE_TEXT_LIMITS = {
  title: { max: 200 },
  subtitle: { max: 400 },
  description: { max: 4000 },
} satisfies Record<string, FieldRule>;

const SECTION_TEXT_LIMITS = {
  heading: { max: 200 },
  subheading: { max: 300 },
  description: { max: 4000 },
} satisfies Record<string, FieldRule>;

/** Rejects markup and control characters; content is rendered as text. */
function checkText(value: unknown, field: string, rule: FieldRule, issues: string[]): string {
  if (typeof value !== 'string') {
    if (rule.required || value !== undefined) issues.push(`${field} must be a string`);
    return '';
  }
  const trimmed = value;
  if (rule.required && trimmed.trim().length === 0) issues.push(`${field} is required`);
  if (trimmed.length > rule.max) issues.push(`${field} exceeds ${rule.max} characters`);
  if (/[<>]/.test(trimmed)) issues.push(`${field} must not contain angle brackets`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed)) issues.push(`${field} contains control characters`);
  return trimmed;
}

function checkPath(value: unknown, field: string, issues: string[]): string {
  if (typeof value !== 'string') {
    issues.push(`${field} must be a string`);
    return '';
  }
  if (!value.startsWith('/')) issues.push(`${field} must start with "/"`);
  if (value.length > 200) issues.push(`${field} is too long`);
  if (/[\s\\]/.test(value)) issues.push(`${field} must not contain whitespace or backslashes`);
  if (value.includes('//') || value.includes('..')) issues.push(`${field} is not a clean path`);
  return value;
}

function checkUrlField(value: unknown, field: string, issues: string[], options: { allowRelative: boolean }): string {
  if (typeof value !== 'string') {
    if (value === undefined || value === null) return '';
    issues.push(`${field} must be a string`);
    return '';
  }
  if (value === '') return '';
  if (options.allowRelative && value.startsWith('/')) {
    return checkPath(value, field, issues);
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      issues.push(`${field} must use http or https`);
    }
    return value;
  } catch {
    issues.push(`${field} is not a valid URL`);
    return value;
  }
}

function checkStringArray(value: unknown, field: string, issues: string[], maxItems = 40, maxLength = 200): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return [];
  }
  if (value.length > maxItems) issues.push(`${field} has too many items (max ${maxItems})`);
  return value.map((entry, index) => checkText(entry, `${field}[${index}]`, { max: maxLength }, issues));
}


/**
 * A canonical must resolve to the page's own route. Absolute URLs are accepted
 * because that is what the legacy `seo_settings.canonical_url` rows contain;
 * anything pointing at a different route would de-index the page it sits on.
 */
function checkCanonical(value: unknown, expectedPath: string, issues: string[]): string {
  if (typeof value !== 'string' || value.trim() === '') return expectedPath;
  const candidate = value.trim();

  if (candidate.startsWith('/')) {
    const path = checkPath(candidate, 'seo.canonicalUrl', issues);
    if (path !== expectedPath) issues.push(`seo.canonicalUrl must resolve to the page path (${expectedPath})`);
    return path;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      issues.push('seo.canonicalUrl must use http or https');
    }
    const normalisedPath = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
    if (normalisedPath !== expectedPath) {
      issues.push(`seo.canonicalUrl must resolve to the page path (${expectedPath})`);
    }
    return candidate;
  } catch {
    issues.push('seo.canonicalUrl must be a path or an absolute URL');
    return candidate;
  }
}


/**
 * Social links in the existing content are frequently placeholders (`#`) until
 * the real profile URLs are supplied. Those are preserved as-is rather than
 * blocking the migration or inventing a destination.
 */
function checkSocialHref(value: unknown, field: string, issues: string[]): string {
  if (value === undefined || value === null || value === '') return '';
  if (value === '#') return '#';
  return checkUrlField(value, field, issues, { allowRelative: false });
}

export function validateSeo(raw: unknown, expectedPath: string, issues: string[]): ContentSeo {
  const seo = (raw ?? {}) as Record<string, unknown>;

  const canonicalUrl = checkCanonical(seo.canonicalUrl ?? expectedPath, expectedPath, issues);

  const robots = typeof seo.robots === 'string' && seo.robots ? seo.robots : DEFAULT_ROBOTS;
  if (!(ALLOWED_ROBOTS as readonly string[]).includes(robots)) {
    issues.push(`seo.robots must be one of: ${ALLOWED_ROBOTS.join(' | ')}`);
  }

  return {
    title: checkText(seo.title ?? '', 'seo.title', { max: 200 }, issues),
    metaTitle: checkText(seo.metaTitle ?? '', 'seo.metaTitle', { max: 200 }, issues),
    metaDescription: checkText(seo.metaDescription ?? '', 'seo.metaDescription', { max: 320 }, issues),
    canonicalUrl,
    robots,
    ogTitle: checkText(seo.ogTitle ?? '', 'seo.ogTitle', { max: 200 }, issues),
    ogDescription: checkText(seo.ogDescription ?? '', 'seo.ogDescription', { max: 320 }, issues),
    ogImage: checkUrlField(seo.ogImage ?? '', 'seo.ogImage', issues, { allowRelative: true }),
  };
}

export function validateSections(raw: unknown, issues: string[]): ContentSection[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push('sections must be an array');
    return [];
  }
  if (raw.length > 30) issues.push('sections has too many entries (max 30)');

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const section = (entry ?? {}) as Record<string, unknown>;
    const id = checkText(section.id ?? '', `sections[${index}].id`, { max: 60, required: true }, issues);
    if (id) {
      if (seen.has(id)) issues.push(`sections[${index}].id "${id}" is duplicated`);
      seen.add(id);
    }
    return {
      id,
      heading: checkText(section.heading ?? '', `sections[${index}].heading`, SECTION_TEXT_LIMITS.heading, issues),
      subheading: checkText(section.subheading ?? '', `sections[${index}].subheading`, SECTION_TEXT_LIMITS.subheading, issues),
      description: checkText(section.description ?? '', `sections[${index}].description`, SECTION_TEXT_LIMITS.description, issues),
    };
  });
}

function validateSiteSettings(raw: unknown, issues: string[]): SiteSettingsContent {
  const settings = (raw ?? {}) as Record<string, unknown>;
  const social = Array.isArray(settings.social)
    ? settings.social.map((entry, index) => {
        const link = (entry ?? {}) as Record<string, unknown>;
        return {
          label: checkText(link.label ?? '', `settings.social[${index}].label`, { max: 60 }, issues),
          href: checkSocialHref(link.href, `settings.social[${index}].href`, issues),
        };
      })
    : [];

  const theme = (settings.theme ?? {}) as Record<string, unknown>;
  const seo = (settings.seo ?? {}) as Record<string, unknown>;

  const latitude = settings.latitude === null || settings.latitude === undefined ? null : Number(settings.latitude);
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    issues.push('settings.latitude must be between -90 and 90');
  }
  const longitude = settings.longitude === null || settings.longitude === undefined ? null : Number(settings.longitude);
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    issues.push('settings.longitude must be between -180 and 180');
  }

  const tagline = checkText(settings.tagline ?? '', 'settings.tagline', { max: 200 }, issues);
  if (isPlaceholderTagline(tagline)) {
    issues.push('settings.tagline contains a seed placeholder; use the approved business tagline');
  }

  return {
    name: checkText(settings.name ?? '', 'settings.name', { max: 120, required: true }, issues),
    legalName: checkText(settings.legalName ?? '', 'settings.legalName', { max: 120 }, issues),
    tagline,
    shortDescription: checkText(settings.shortDescription ?? '', 'settings.shortDescription', { max: 500 }, issues),
    logo: checkUrlField(settings.logo ?? '', 'settings.logo', issues, { allowRelative: true }),
    favicon: checkUrlField(settings.favicon ?? '', 'settings.favicon', issues, { allowRelative: true }),
    phone: checkText(settings.phone ?? '', 'settings.phone', { max: 40 }, issues),
    whatsapp: checkText(settings.whatsapp ?? '', 'settings.whatsapp', { max: 40 }, issues),
    email: checkText(settings.email ?? '', 'settings.email', { max: 160 }, issues),
    address: checkText(settings.address ?? '', 'settings.address', { max: 400 }, issues),
    venueAddress: checkText(settings.venueAddress ?? '', 'settings.venueAddress', { max: 400 }, issues),
    businessHours: checkText(settings.businessHours ?? '', 'settings.businessHours', { max: 120 }, issues),
    googleMapsUrl: checkUrlField(settings.googleMapsUrl ?? '', 'settings.googleMapsUrl', issues, { allowRelative: false }),
    latitude,
    longitude,
    footerText: checkText(settings.footerText ?? '', 'settings.footerText', { max: 500 }, issues),
    contactButtonsEnabled: settings.contactButtonsEnabled !== false,
    social,
    theme: {
      primaryColor: checkText(theme.primaryColor ?? '#721224', 'settings.theme.primaryColor', { max: 32 }, issues),
      goldBright: checkText(theme.goldBright ?? '#e0b868', 'settings.theme.goldBright', { max: 32 }, issues),
      fontPreset: checkText(theme.fontPreset ?? 'heritage', 'settings.theme.fontPreset', { max: 32 }, issues),
    },
    seo: {
      defaultTitle: checkText(seo.defaultTitle ?? '', 'settings.seo.defaultTitle', { max: 200 }, issues),
      defaultDescription: checkText(seo.defaultDescription ?? '', 'settings.seo.defaultDescription', { max: 320 }, issues),
      ogImage: checkUrlField(seo.ogImage ?? '', 'settings.seo.ogImage', issues, { allowRelative: true }),
    },
  };
}

function validateHomepageSections(raw: unknown, issues: string[]): HomepageSectionContent[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push('homepageSections must be an array');
    return [];
  }
  if (raw.length > 20) issues.push('homepageSections has too many entries (max 20)');

  return raw.map((entry, index) => {
    const section = (entry ?? {}) as Record<string, unknown>;
    return {
      sectionKey: checkText(section.sectionKey ?? '', `homepageSections[${index}].sectionKey`, { max: 60, required: true }, issues),
      sectionType: checkText(section.sectionType ?? '', `homepageSections[${index}].sectionType`, { max: 60 }, issues),
      title: checkText(section.title ?? '', `homepageSections[${index}].title`, { max: 200 }, issues),
      subtitle: checkText(section.subtitle ?? '', `homepageSections[${index}].subtitle`, { max: 400 }, issues),
      description: checkText(section.description ?? '', `homepageSections[${index}].description`, { max: 4000 }, issues),
      imageUrl: checkUrlField(section.imageUrl ?? '', `homepageSections[${index}].imageUrl`, issues, { allowRelative: true }),
      ctaLabel: checkText(section.ctaLabel ?? '', `homepageSections[${index}].ctaLabel`, { max: 80 }, issues),
      ctaUrl: checkUrlField(section.ctaUrl ?? '', `homepageSections[${index}].ctaUrl`, issues, { allowRelative: true }),
      badge: checkText(section.badge ?? '', `homepageSections[${index}].badge`, { max: 80 }, issues),
      isVisible: section.isVisible !== false,
      sortOrder: Number.isFinite(Number(section.sortOrder)) ? Number(section.sortOrder) : index,
      config: section.config && typeof section.config === 'object' ? (section.config as Record<string, unknown>) : {},
    };
  });
}

function validateServices(raw: unknown, issues: string[]): ServiceContent[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push('services must be an array');
    return [];
  }
  if (raw.length > 30) issues.push('services has too many entries (max 30)');

  return raw.map((entry, index) => {
    const service = (entry ?? {}) as Record<string, unknown>;
    const slug = checkText(service.slug ?? '', `services[${index}].slug`, { max: 80, required: true }, issues);
    if (slug && !/^[a-z0-9-]+$/.test(slug)) issues.push(`services[${index}].slug must be lowercase letters, digits and dashes`);
    return {
      slug,
      title: checkText(service.title ?? '', `services[${index}].title`, { max: 120, required: true }, issues),
      description: checkText(service.description ?? '', `services[${index}].description`, { max: 1000 }, issues),
      badge: checkText(service.badge ?? '', `services[${index}].badge`, { max: 80 }, issues),
      imageUrl: checkUrlField(service.imageUrl ?? '', `services[${index}].imageUrl`, issues, { allowRelative: true }),
      features: checkStringArray(service.features, `services[${index}].features`, issues),
      isVisible: service.isVisible !== false,
      sortOrder: Number.isFinite(Number(service.sortOrder)) ? Number(service.sortOrder) : index,
    };
  });
}

/**
 * Validates a raw document and returns the normalised value.
 * Throws `ContentValidationError` listing every problem found.
 */
export function validateContentDocument(raw: unknown): ContentDocument {
  const issues: string[] = [];
  if (!raw || typeof raw !== 'object') {
    throw new ContentValidationError(['document must be an object']);
  }

  const candidate = raw as Record<string, unknown>;

  if (Number(candidate.schemaVersion) !== CONTENT_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${CONTENT_SCHEMA_VERSION}`);
  }
  if (!isPageId(candidate.pageId)) {
    issues.push(`pageId must be one of: ${PAGE_IDS.join(', ')}`);
    throw new ContentValidationError(issues);
  }

  const pageId = candidate.pageId;
  const expectedPath = PAGE_PATHS[pageId];
  const path = checkPath(candidate.path ?? expectedPath, 'path', issues);
  if (path !== expectedPath) issues.push(`path must be "${expectedPath}" for page "${pageId}"`);

  const contentVersion = Number(candidate.contentVersion);
  if (!Number.isInteger(contentVersion) || contentVersion < 1) {
    issues.push('contentVersion must be a positive integer');
  }

  const updatedAt = checkText(candidate.updatedAt ?? '', 'updatedAt', { max: 40, required: true }, issues);
  if (updatedAt && Number.isNaN(Date.parse(updatedAt))) issues.push('updatedAt must be an ISO timestamp');
  const updatedBy = checkText(candidate.updatedBy ?? '', 'updatedBy', { max: 120, required: true }, issues);

  if (pageId === 'site') {
    const document: SiteDocument = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      pageId: 'site',
      path,
      contentVersion,
      updatedAt,
      updatedBy,
      settings: validateSiteSettings(candidate.settings, issues),
      homepageSections: validateHomepageSections(candidate.homepageSections, issues),
      services: validateServices(candidate.services, issues),
    };
    if (issues.length > 0) throw new ContentValidationError(issues);
    return document;
  }

  const document: PageDocument = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    pageId,
    path,
    contentVersion,
    updatedAt,
    updatedBy,
    title: checkText(candidate.title ?? '', 'title', { max: PAGE_TEXT_LIMITS.title.max, required: true }, issues),
    subtitle: checkText(candidate.subtitle ?? '', 'subtitle', PAGE_TEXT_LIMITS.subtitle, issues),
    description: checkText(candidate.description ?? '', 'description', PAGE_TEXT_LIMITS.description, issues),
    seo: validateSeo(candidate.seo, expectedPath, issues),
    sections: validateSections(candidate.sections, issues),
    config: candidate.config && typeof candidate.config === 'object' ? (candidate.config as Record<string, unknown>) : {},
  };

  if (issues.length > 0) throw new ContentValidationError(issues);
  return document;
}

/** Validates a whole publication and rejects duplicate paths. */
export function validatePublicationDocuments(rawDocuments: unknown[]): ContentDocument[] {
  if (rawDocuments.length === 0) throw new ContentValidationError(['no documents supplied']);

  const documents = rawDocuments.map((raw) => validateContentDocument(raw));
  const paths = new Map<string, PageId>();
  for (const document of documents) {
    const existing = paths.get(document.path);
    if (existing) {
      throw new ContentValidationError([`path "${document.path}" is used by both "${existing}" and "${document.pageId}"`]);
    }
    paths.set(document.path, document.pageId);
  }

  const ids = new Set(documents.map((document) => document.pageId));
  const missing = PAGE_IDS.filter((pageId) => !ids.has(pageId));
  if (missing.length > 0) {
    throw new ContentValidationError([`publication is incomplete; missing page(s): ${missing.join(', ')}`]);
  }

  return documents;
}
