import { fetchSanity } from './client';
import {
  siteSettingsQuery,
  homepageQuery,
  servicesQuery,
  cataloguePresentationsQuery,
  galleryPresentationsQuery,
} from './queries';
import type {
  SanitySiteSettings,
  SanityHomepage,
  SanityServiceContent,
  SanityCataloguePresentation,
  SanityGalleryPresentation,
} from './types';
import { site } from '../config';
import { resolveSanityImage } from './image';

export interface MergedSiteSettings {
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
  social: Array<{ label: string; href: string }>;
  theme: {
    primaryColor: string;
    goldBright: string;
    fontPreset: string;
  };
  seo: {
    defaultTitle: string;
    defaultDescription: string;
    ogImage: string;
  };
}

export interface MergedHomepageContent {
  heroHeading: string;
  heroSubtitle: string;
  heroImage: string;
  primaryCta: { label: string; url: string };
  secondaryCta: { label: string; url: string };
  announcementBar: {
    enabled: boolean;
    text: string;
    location: string;
    phone: string;
  };
  features: Array<{ icon: string; title: string; description: string }>;
  steps: Array<{ stepNumber: string; title: string; description: string }>;
  sectionsVisibility: {
    mandaps: boolean;
    stages: boolean;
    equipment: boolean;
    catering: boolean;
    gallery: boolean;
    stats: boolean;
  };
  promotionalBanner?: {
    enabled: boolean;
    badge: string;
    headline: string;
    description: string;
    ctaLabel: string;
    ctaUrl: string;
  };
}

/**
 * Returns merged site settings, prioritizing Sanity CMS content
 * with seamless fallback to static site config.
 */
export async function getSiteSettings(preview = false): Promise<MergedSiteSettings> {
  const sanity = await fetchSanity<SanitySiteSettings>(siteSettingsQuery, {}, { preview });

  const logoUrl = sanity?.logoFilebaseUrl || resolveSanityImage(sanity?.logo, site.logo);
  const ogImageUrl = sanity?.seo?.ogImageFilebaseUrl || resolveSanityImage(sanity?.seo?.ogImage, '/storage/assets/banners/homepage/banner-hero.webp');

  const social = sanity?.socialLinks && sanity.socialLinks.length > 0
    ? sanity.socialLinks.map((s) => ({ label: s.platform, href: s.url }))
    : site.social.map((s) => ({ label: s.label, href: s.href }));

  return {
    name: sanity?.name || site.name,
    legalName: sanity?.legalName || site.legalName,
    tagline: sanity?.tagline || site.tagline,
    shortDescription: sanity?.shortDescription || site.shortDescription,
    logo: logoUrl,
    favicon: sanity?.favicon || site.logo,
    phone: sanity?.phone || site.phone,
    whatsapp: sanity?.whatsapp || site.whatsapp,
    email: sanity?.email || site.email,
    address: sanity?.address || site.address,
    venueAddress: sanity?.venueAddress || site.venueAddress,
    businessHours: sanity?.businessHours || 'Daily, 10:00 – 19:00',
    social,
    theme: {
      primaryColor: sanity?.theme?.primaryColor || '#721224',
      goldBright: sanity?.theme?.goldBright || '#e0b868',
      fontPreset: sanity?.theme?.fontPreset || 'heritage',
    },
    seo: {
      defaultTitle: sanity?.seo?.defaultTitle || `${site.name} | Wedding Mandaps, Stage Designs & Event Equipment in Ranchi`,
      defaultDescription: sanity?.seo?.defaultDescription || site.shortDescription,
      ogImage: ogImageUrl,
    },
  };
}

/**
 * Returns merged homepage content, prioritizing Sanity CMS content
 * with fallback to hardcoded / database values.
 */
export async function getHomepageContent(
  fallbackHeroImage = '/storage/assets/banners/homepage/banner-hero.webp',
  preview = false,
): Promise<MergedHomepageContent> {
  const sanity = await fetchSanity<SanityHomepage>(homepageQuery, {}, { preview });

  const heroImageUrl =
    sanity?.heroImageFilebaseUrl ||
    resolveSanityImage(sanity?.heroImage, fallbackHeroImage);

  return {
    heroHeading: sanity?.heroHeading || "Create the Wedding Setup You've Always Imagined.",
    heroSubtitle:
      sanity?.heroSubtitle ||
      'Mandaps, stage designs, furniture and event equipment — planned and delivered by one Ranchi team. Choose what you love, add your dimensions and send a single, complete requirement.',
    heroImage: heroImageUrl,
    primaryCta: {
      label: sanity?.primaryCta?.label || 'Explore Mandaps',
      url: sanity?.primaryCta?.url || '/mandaps',
    },
    secondaryCta: {
      label: sanity?.secondaryCta?.label || 'Plan Your Event',
      url: sanity?.secondaryCta?.url || '/plan',
    },
    announcementBar: {
      enabled: sanity?.announcementBar?.enabled ?? true,
      text:
        sanity?.announcementBar?.text ||
        'Mandaps, stage designs, furniture & equipment — enquiries are quotations, not automatic bookings',
      location: sanity?.announcementBar?.location || 'Wedding planning across Ranchi & Jharkhand',
      phone: sanity?.announcementBar?.phone || site.phone,
    },
    features:
      sanity?.features && sanity.features.length > 0
        ? sanity.features.map((f) => ({
            icon: f.icon || 'sparkles',
            title: f.title || '',
            description: f.description || '',
          }))
        : [
            { icon: 'archway', title: 'Signature Mandaps', description: 'Carved, floral and contemporary mandap concepts built to your dimensions.' },
            { icon: 'theater', title: 'Stage Design Studio', description: 'Reception and ceremony stages styled around your palette and venue.' },
            { icon: 'chair', title: 'Furniture & Equipment', description: 'Chairs, tables, lounge seating, lighting and event essentials in one place.' },
            { icon: 'shield', title: 'One Planning Team', description: 'A single Ranchi-based coordinator from first enquiry to final setup.' },
          ],
    steps:
      sanity?.steps && sanity.steps.length > 0
        ? sanity.steps.map((s) => ({
            stepNumber: s.stepNumber || '',
            title: s.title || '',
            description: s.description || '',
          }))
        : [
            { stepNumber: '01', title: 'Share your date & venue', description: 'Tell us the event type, date, guest count and location in Ranchi.' },
            { stepNumber: '02', title: 'Select mandap & stage', description: 'Choose a design or request custom dimensions for your venue.' },
            { stepNumber: '03', title: 'Build your equipment list', description: 'Add chairs, tables, lounge seating, lighting and essentials with quantities.' },
            { stepNumber: '04', title: 'Receive a quotation', description: 'Our team checks availability and sends an itemised quotation — not an auto-booking.' },
            { stepNumber: '05', title: 'Confirm in writing', description: 'Dates and stock are held only after you confirm the quotation with us.' },
          ],
    sectionsVisibility: {
      mandaps: sanity?.sectionsVisibility?.mandaps ?? true,
      stages: sanity?.sectionsVisibility?.stages ?? true,
      equipment: sanity?.sectionsVisibility?.equipment ?? true,
      catering: sanity?.sectionsVisibility?.catering ?? true,
      gallery: sanity?.sectionsVisibility?.gallery ?? true,
      stats: sanity?.sectionsVisibility?.stats ?? true,
    },
    promotionalBanner: sanity?.promotionalBanner?.enabled
      ? {
          enabled: true,
          badge: sanity.promotionalBanner.badge || 'Special Offer',
          headline: sanity.promotionalBanner.headline || '',
          description: sanity.promotionalBanner.description || '',
          ctaLabel: sanity.promotionalBanner.ctaLabel || 'Learn More',
          ctaUrl: sanity.promotionalBanner.ctaUrl || '/plan',
        }
      : undefined,
  };
}

/**
 * Returns catalogue presentations mapped by `${itemType}:${referenceSlug}`.
 */
export async function getCataloguePresentationsMap(
  preview = false,
): Promise<Map<string, SanityCataloguePresentation>> {
  const items = await fetchSanity<SanityCataloguePresentation[]>(
    cataloguePresentationsQuery,
    {},
    { preview },
  );

  const map = new Map<string, SanityCataloguePresentation>();
  if (items && Array.isArray(items)) {
    for (const item of items) {
      if (item.itemType && item.referenceSlug) {
        map.set(`${item.itemType}:${item.referenceSlug}`, item);
      }
    }
  }
  return map;
}

/**
 * Returns gallery presentations mapped by `categorySlug`.
 */
export async function getGalleryPresentationsMap(
  preview = false,
): Promise<Map<string, SanityGalleryPresentation>> {
  const items = await fetchSanity<SanityGalleryPresentation[]>(
    galleryPresentationsQuery,
    {},
    { preview },
  );

  const map = new Map<string, SanityGalleryPresentation>();
  if (items && Array.isArray(items)) {
    for (const item of items) {
      if (item.categorySlug) {
        map.set(item.categorySlug, item);
      }
    }
  }
  return map;
}

/**
 * Returns editorial services list from Sanity.
 */
export async function getServices(preview = false): Promise<SanityServiceContent[]> {
  const items = await fetchSanity<SanityServiceContent[]>(servicesQuery, {}, { preview });
  return items || [];
}
