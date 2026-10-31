import { getD1Client } from './d1-client';
import { getSnapshot } from './snapshot';
import type {
  PageContent,
  SiteSettings,
  MergedSiteSettings,
  HomepageSection,
  MergedHomepageContent,
  ServiceItem,
  MandapItem,
  StageItem,
  FurnitureCategory,
  FurnitureItem,
  CateringPackage,
  GalleryCategory,
  GalleryItem,
  SeoSettings,
  VideoPlatform,
  VideoPreviewItem,
  ParsedVideoUrl,
} from './types';
import { site } from '../config';

export type {
  PageContent,
  SiteSettings,
  MergedSiteSettings,
  HomepageSection,
  MergedHomepageContent,
  ServiceItem,
  MandapItem,
  StageItem,
  FurnitureCategory,
  FurnitureItem,
  CateringPackage,
  GalleryCategory,
  GalleryItem,
  SeoSettings,
  VideoPlatform,
  VideoPreviewItem,
  ParsedVideoUrl,
};

// In-memory cache for fast SSR page renders.
// Stored on globalThis because the Astro server build can emit this module in
// more than one chunk, which would otherwise create independent caches (double
// D1 fetches and partial invalidation).
interface ContentCacheEntry {
  data: unknown;
  timestamp: number;
}

interface ContentCacheState {
  entries: Map<string, ContentCacheEntry>;
  pending: Map<string, Promise<unknown>>;
}

interface ContentCacheGlobalScope {
  __eventPointContentCache?: ContentCacheState;
}

const cacheScope = globalThis as typeof globalThis & ContentCacheGlobalScope;
const contentState: ContentCacheState =
  cacheScope.__eventPointContentCache ?? (cacheScope.__eventPointContentCache = { entries: new Map(), pending: new Map() });

// Public content changes rarely and every write path calls
// invalidateContentCache(), so a longer TTL removes repeated remote D1 round
// trips from cold renders (each D1 call costs ~0.5-1s from this region).
// Multi-instance staleness is bounded by this TTL and is documented.
const CACHE_TTL_MS = 300_000; // 5 minutes; instant invalidation on mutation

// Preview (admin) reads want near-fresh data but do not need a full bypass:
// a short TTL keeps admin tabs fast while edits invalidate the cache instantly.
const PREVIEW_CACHE_TTL_MS = 10_000;

export function invalidateContentCache(key?: string): void {
  if (key) {
    contentState.entries.delete(key);
  } else {
    contentState.entries.clear();
  }
}

async function getCached<T>(key: string, fetcher: () => Promise<T>, preview = false): Promise<T> {
  const ttl = preview ? PREVIEW_CACHE_TTL_MS : CACHE_TTL_MS;

  const cached = contentState.entries.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }

  const inflight = contentState.pending.get(key);
  if (inflight) return inflight as Promise<T>;

  const promise = fetcher()
    .then((fresh) => {
      contentState.entries.set(key, { data: fresh, timestamp: Date.now() });
      return fresh;
    })
    .finally(() => {
      contentState.pending.delete(key);
    });

  contentState.pending.set(key, promise);
  return promise;
}

/**
 * Merges a raw site_settings row with static fallbacks. Pure, so the snapshot
 * path and the live D1 path produce identical output.
 */
export function mergeSiteSettingsRow(row: SiteSettings | null | undefined): MergedSiteSettings {
  if (row) {
    let social: Array<{ label: string; href: string }> = [];
    try {
      const parsed = JSON.parse(row.social_links_json || '[]');
      social = Array.isArray(parsed)
        ? parsed.map((s: any) => ({ label: s.platform || s.label, href: s.url || s.href }))
        : [];
    } catch {
      social = site.social.map((s) => ({ label: s.label, href: s.href }));
    }
    if (social.length === 0) {
      social = site.social.map((s) => ({ label: s.label, href: s.href }));
    }

    return {
      name: row.name || site.name,
      legalName: row.legal_name || site.legalName,
      tagline: row.tagline || site.tagline,
      shortDescription: row.short_description || site.shortDescription,
      logo: row.logo_url || site.logo,
      favicon: row.favicon_url || site.logo,
      phone: row.phone || site.phone,
      whatsapp: row.whatsapp || site.whatsapp,
      email: row.email || site.email,
      address: row.address || site.address,
      venueAddress: row.venue_address || site.venueAddress,
      businessHours: row.business_hours || 'Daily, 10:00 – 19:00',
      announcementText: row.announcement_text || undefined,
      googleMapsUrl: row.google_maps_url || 'https://maps.google.com/?q=Event+Point+Main+Road+Ranchi',
      latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : 23.3441,
      longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : 85.3096,
      footerText: row.footer_text || '',
      contactButtonsEnabled: Boolean(row.contact_buttons_enabled ?? 1),
      social,
      theme: {
        primaryColor: row.primary_color || '#721224',
        goldBright: row.gold_bright || '#e0b868',
        fontPreset: row.font_preset || 'heritage',
      },
      seo: {
        defaultTitle: row.default_title || `${site.name} | Wedding Mandaps, Stage Designs & Event Equipment in Ranchi`,
        defaultDescription: row.default_description || site.shortDescription,
        ogImage: row.og_image_url || '/storage/assets/banners/homepage/banner-hero.webp',
      },
    };
  }

  return {
    name: site.name,
    legalName: site.legalName,
    tagline: site.tagline,
    shortDescription: site.shortDescription,
    logo: site.logo,
    favicon: site.logo,
    phone: site.phone,
    whatsapp: site.whatsapp,
    email: site.email,
    address: site.address,
    venueAddress: site.venueAddress,
    businessHours: 'Daily, 10:00 – 19:00',
    googleMapsUrl: 'https://maps.google.com/?q=Event+Point+Main+Road+Ranchi',
    latitude: 23.3441,
    longitude: 85.3096,
    footerText: '',
    contactButtonsEnabled: true,
    social: site.social.map((s) => ({ label: s.label, href: s.href })),
    theme: {
      primaryColor: '#721224',
      goldBright: '#e0b868',
      fontPreset: 'heritage',
    },
    seo: {
      defaultTitle: `${site.name} | Wedding Mandaps, Stage Designs & Event Equipment in Ranchi`,
      defaultDescription: site.shortDescription,
      ogImage: '/storage/assets/banners/homepage/banner-hero.webp',
    },
  };
}

/**
 * Returns merged site settings from the bundled snapshot (public builds) or
 * live Cloudflare D1 (admin preview / local dev without a snapshot).
 */
export async function getSiteSettings(preview = false): Promise<MergedSiteSettings> {
  const snapshot = preview ? null : getSnapshot();
  if (snapshot) return mergeSiteSettingsRow(snapshot.settings);

  return getCached<MergedSiteSettings>(
    `site_settings:${preview}`,
    async () => {
      try {
        const d1 = getD1Client();
        const res = await d1.query<SiteSettings>('SELECT * FROM site_settings WHERE id = ? LIMIT 1', ['global']);
        return mergeSiteSettingsRow(res.results?.[0] ?? null);
      } catch (err) {
        console.warn('[D1] getSiteSettings failed, using static config fallback:', (err as Error).message);
        return mergeSiteSettingsRow(null);
      }
    },
    preview,
  );
}

/**
 * Merges homepage sections into the render model. Pure, so the snapshot path
 * and the live D1 path produce identical output.
 */
export function mergeHomepageContentFromSections(
  sections: HomepageSection[],
  fallbackHeroImage: string,
): MergedHomepageContent {
  const hero = sections.find((s) => s.section_key === 'hero');
  const featuresSec = sections.find((s) => s.section_key === 'features');
  const stepsSec = sections.find((s) => s.section_key === 'steps');
  const promoSec = sections.find((s) => s.section_key === 'promo_banner');

  let features: Array<{ icon: string; title: string; description: string }> = [];
  if (featuresSec?.config_json) {
    try {
      features = JSON.parse(featuresSec.config_json);
    } catch {}
  }
  if (!features || features.length === 0) {
    features = [
      { icon: 'archway', title: 'Signature Mandaps', description: 'Carved, floral and contemporary mandap concepts built to your dimensions.' },
      { icon: 'theater', title: 'Stage Design Studio', description: 'Reception and ceremony stages styled around your palette and venue.' },
      { icon: 'chair', title: 'Furniture & Equipment', description: 'Chairs, tables, lounge seating, lighting and event essentials in one place.' },
      { icon: 'shield', title: 'One Planning Team', description: 'A single Ranchi-based coordinator from first enquiry to final setup.' },
    ];
  }

  let steps: Array<{ stepNumber: string; title: string; description: string }> = [];
  if (stepsSec?.config_json) {
    try {
      steps = JSON.parse(stepsSec.config_json);
    } catch {}
  }
  if (!steps || steps.length === 0) {
    steps = [
      { stepNumber: '01', title: 'Share your date & venue', description: 'Tell us the event type, date, guest count and location in Ranchi.' },
      { stepNumber: '02', title: 'Select mandap & stage', description: 'Choose a design or request custom dimensions for your venue.' },
      { stepNumber: '03', title: 'Build your equipment list', description: 'Add chairs, tables, lounge seating, lighting and essentials with quantities.' },
      { stepNumber: '04', title: 'Receive a quotation', description: 'Our team checks availability and sends an itemised quotation — not an auto-booking.' },
      { stepNumber: '05', title: 'Confirm in writing', description: 'Dates and stock are held only after you confirm the quotation with us.' },
    ];
  }

  let secondaryCta = { label: 'Plan Your Event', url: '/plan' };
  if (hero?.config_json) {
    try {
      const parsed = JSON.parse(hero.config_json);
      if (parsed.secondaryCta) secondaryCta = parsed.secondaryCta;
    } catch {}
  }

  return {
    heroHeading: hero?.title || "Create the Wedding Setup You've Always Imagined.",
    heroSubtitle: hero?.subtitle || 'Mandaps, stage designs, furniture and event equipment — planned and delivered by one Ranchi team.',
    heroImage: hero?.image_url || fallbackHeroImage,
    primaryCta: {
      label: hero?.cta_label || 'Explore Mandaps',
      url: hero?.cta_url || '/mandaps',
    },
    secondaryCta,
    announcementBar: {
      enabled: true,
      text: 'Mandaps, stage designs, furniture & equipment — enquiries are quotations, not automatic bookings',
      location: 'Wedding planning across Ranchi & Jharkhand',
      phone: site.phone,
    },
    features,
    steps,
    sectionsVisibility: {
      mandaps: true,
      stages: true,
      equipment: true,
      catering: true,
      gallery: true,
      stats: true,
    },
    promotionalBanner: promoSec
      ? {
          enabled: Boolean(promoSec.is_visible),
          badge: promoSec.badge || 'Special Offer',
          headline: promoSec.title || '',
          description: promoSec.description || '',
          ctaLabel: promoSec.cta_label || 'Learn More',
          ctaUrl: promoSec.cta_url || '/plan',
        }
      : undefined,
  };
}

/**
 * Returns merged homepage content from the bundled snapshot (public builds) or
 * live Cloudflare D1 (admin preview / local dev without a snapshot).
 */
export async function getHomepageContent(
  fallbackHeroImage = '/storage/assets/banners/homepage/banner-hero.webp',
  preview = false,
): Promise<MergedHomepageContent> {
  const snapshot = preview ? null : getSnapshot();
  if (snapshot) return mergeHomepageContentFromSections(snapshot.homeSections, fallbackHeroImage);

  return getCached<MergedHomepageContent>(
    `homepage_content:${preview}`,
    async () => {
      try {
        const d1 = getD1Client();
        const res = await d1.query<HomepageSection>('SELECT * FROM homepage_sections WHERE is_visible = 1 ORDER BY sort_order ASC');
        return mergeHomepageContentFromSections(res.results || [], fallbackHeroImage);
      } catch (err) {
        console.warn('[D1] getHomepageContent fallback:', (err as Error).message);
        return {
          heroHeading: "Create the Wedding Setup You've Always Imagined.",
          heroSubtitle:
            'Mandaps, stage designs, furniture and event equipment — planned and delivered by one Ranchi team. Choose what you love, add your dimensions and send a single, complete requirement.',
          heroImage: fallbackHeroImage,
          primaryCta: { label: 'Explore Mandaps', url: '/mandaps' },
          secondaryCta: { label: 'Plan Your Event', url: '/plan' },
          announcementBar: {
            enabled: true,
            text: 'Mandaps, stage designs, furniture & equipment — enquiries are quotations, not automatic bookings',
            location: 'Wedding planning across Ranchi & Jharkhand',
            phone: site.phone,
          },
          features: [
            { icon: 'archway', title: 'Signature Mandaps', description: 'Carved, floral and contemporary mandap concepts built to your dimensions.' },
            { icon: 'theater', title: 'Stage Design Studio', description: 'Reception and ceremony stages styled around your palette and venue.' },
            { icon: 'chair', title: 'Furniture & Equipment', description: 'Chairs, tables, lounge seating, lighting and event essentials in one place.' },
            { icon: 'shield', title: 'One Planning Team', description: 'A single Ranchi-based coordinator from first enquiry to final setup.' },
          ],
          steps: [
            { stepNumber: '01', title: 'Share your date & venue', description: 'Tell us the event type, date, guest count and location in Ranchi.' },
            { stepNumber: '02', title: 'Select mandap & stage', description: 'Choose a design or request custom dimensions for your venue.' },
            { stepNumber: '03', title: 'Build your equipment list', description: 'Add chairs, tables, lounge seating, lighting and essentials with quantities.' },
            { stepNumber: '04', title: 'Receive a quotation', description: 'Our team checks availability and sends an itemised quotation — not an auto-booking.' },
            { stepNumber: '05', title: 'Confirm in writing', description: 'Dates and stock are held only after you confirm the quotation with us.' },
          ],
          sectionsVisibility: {
            mandaps: true,
            stages: true,
            equipment: true,
            catering: true,
            gallery: true,
            stats: true,
          },
        };
      }
    },
    preview,
  );
}

/**
 * Returns services from Cloudflare D1.
 */
export async function getServices(preview = false): Promise<ServiceItem[]> {
  const snapshot = preview ? null : getSnapshot();
  if (snapshot) return snapshot.services.slice();

  return getCached<ServiceItem[]>(
    `services:${preview}`,
    async () => {
      const d1 = getD1Client();
      const res = await d1.query<any>(
        preview
          ? 'SELECT * FROM services ORDER BY sort_order ASC'
          : 'SELECT * FROM services WHERE is_visible = 1 ORDER BY sort_order ASC',
      );
      return (res.results || []).map((s) => {
        let features: string[] = [];
        try { features = JSON.parse(s.features_json || '[]'); } catch {}
        return {
          id: s.id,
          slug: s.slug,
          title: s.title,
          description: s.description || '',
          badge: s.badge || '',
          image_url: s.image_url || '',
          features,
          is_visible: Boolean(s.is_visible),
          sort_order: s.sort_order || 0,
        };
      });
    },
    preview,
  );
}

/**
 * Returns mandap list from Cloudflare D1.
 */
export async function getMandaps(preview = false): Promise<MandapItem[]> {
  const snapshot = preview ? null : getSnapshot();
  if (snapshot) return snapshot.mandaps.slice();

  return getCached<MandapItem[]>(
    `mandaps:${preview}`,
    async () => {
      const d1 = getD1Client();
      // One batched D1 round trip instead of two sequential HTTP calls.
      const [mandapsRes, galleryRes] = await d1.batch<any>([
        {
          sql: preview
            ? 'SELECT * FROM mandaps ORDER BY sort_order ASC'
            : 'SELECT * FROM mandaps WHERE is_visible = 1 ORDER BY sort_order ASC',
        },
        { sql: 'SELECT * FROM mandap_gallery ORDER BY sort_order ASC' },
      ]);
      const galleryByMandap = new Map<number, Array<{ id: number; image_url: string; caption: string; sort_order: number }>>();

      for (const g of galleryRes.results || []) {
        if (!galleryByMandap.has(g.mandap_id)) {
          galleryByMandap.set(g.mandap_id, []);
        }
        galleryByMandap.get(g.mandap_id)!.push({
          id: g.id,
          image_url: g.image_url,
          caption: g.caption || '',
          sort_order: g.sort_order || 0,
        });
      }

      return (mandapsRes.results || []).map((m) => {
        let features: string[] = [];
        try { features = JSON.parse(m.features_json || '[]'); } catch {}
        return {
          id: m.id,
          name: m.name,
          slug: m.slug,
          description: m.description || '',
          category: m.category || 'Traditional Royal',
          length_ft: Number(m.length_ft || 16),
          width_ft: Number(m.width_ft || 16),
          height_ft: Number(m.height_ft || 12),
          dimension_unit: m.dimension_unit || 'ft',
          material_specs: m.material_specs || '',
          price_starting_paise: Number(m.price_starting_paise || 0),
          capacity: Number(m.capacity || 0),
          features,
          image_url: m.image_url || '',
          location_name: m.location_name || '',
          address: m.address || '',
          latitude: m.latitude !== null && m.latitude !== undefined ? Number(m.latitude) : null,
          longitude: m.longitude !== null && m.longitude !== undefined ? Number(m.longitude) : null,
          google_maps_url: m.google_maps_url || '',
          directions_url: m.directions_url || '',
          show_location: Boolean(m.show_location),
          gallery: galleryByMandap.get(m.id) || [],
          is_featured: Boolean(m.is_featured),
          is_visible: Boolean(m.is_visible),
          sort_order: m.sort_order || 0,
        };
      });
    },
    preview,
  );
}

export async function getMandapBySlug(slug: string, preview = false): Promise<MandapItem | null> {
  const all = await getMandaps(preview);
  return all.find((m) => m.slug === slug) || null;
}

/**
 * Returns stages list from Cloudflare D1.
 */
export async function getStages(preview = false): Promise<StageItem[]> {
  const snapshot = preview ? null : getSnapshot();
  if (snapshot) return snapshot.stages.slice();

  return getCached<StageItem[]>(
    `stages:${preview}`,
    async () => {
      const d1 = getD1Client();
      // One batched D1 round trip instead of two sequential HTTP calls.
      const [stagesRes, galleryRes] = await d1.batch<any>([
        {
          sql: preview
            ? 'SELECT * FROM stages ORDER BY sort_order ASC'
            : 'SELECT * FROM stages WHERE is_visible = 1 ORDER BY sort_order ASC',
        },
        { sql: 'SELECT * FROM stage_gallery ORDER BY sort_order ASC' },
      ]);
      const galleryByStage = new Map<number, Array<{ id: number; image_url: string; caption: string; sort_order: number }>>();

      for (const g of galleryRes.results || []) {
        if (!galleryByStage.has(g.stage_id)) {
          galleryByStage.set(g.stage_id, []);
        }
        galleryByStage.get(g.stage_id)!.push({
          id: g.id,
          image_url: g.image_url,
          caption: g.caption || '',
          sort_order: g.sort_order || 0,
        });
      }

      return (stagesRes.results || []).map((s) => {
        return {
          id: s.id,
          name: s.name,
          slug: s.slug,
          description: s.description || '',
          style_category: s.style_category || 'Royal Reception',
          length_ft: Number(s.length_ft || 24),
          width_ft: Number(s.width_ft || 16),
          height_ft: Number(s.height_ft || 14),
          dimension_unit: s.dimension_unit || 'ft',
          decoration_notes: s.decoration_notes || '',
          price_starting_paise: Number(s.price_starting_paise || 0),
          image_url: s.image_url || '',
          gallery: galleryByStage.get(s.id) || [],
          is_featured: Boolean(s.is_featured),
          is_visible: Boolean(s.is_visible),
          sort_order: s.sort_order || 0,
        };
      });
    },
    preview,
  );
}

export async function getStageBySlug(slug: string, preview = false): Promise<StageItem | null> {
  const all = await getStages(preview);
  return all.find((s) => s.slug === slug) || null;
}

/**
 * Returns furniture/equipment categories and items from Cloudflare D1.
 */
export async function getFurnitureCategories(): Promise<FurnitureCategory[]> {
  const snapshot = getSnapshot();
  if (snapshot) return snapshot.furnitureCategories.slice();

  return getCached<FurnitureCategory[]>('furniture_categories', async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM furniture_categories WHERE is_visible = 1 ORDER BY sort_order ASC');
    return (res.results || []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon: c.icon || 'chair',
      sort_order: c.sort_order || 0,
      is_visible: Boolean(c.is_visible),
    }));
  });
}

export async function getFurnitureItems(categoryId?: number): Promise<FurnitureItem[]> {
  const snapshot = getSnapshot();
  if (snapshot) {
    const items = categoryId
      ? snapshot.furnitureItems.filter((item) => item.category_id === categoryId)
      : snapshot.furnitureItems;
    return items.slice();
  }

  return getCached<FurnitureItem[]>(`furniture_items:${categoryId ?? 'all'}`, async () => {
    const d1 = getD1Client();
    const sql = categoryId
      ? 'SELECT * FROM furniture_items WHERE category_id = ? AND is_visible = 1 ORDER BY sort_order ASC'
      : 'SELECT * FROM furniture_items WHERE is_visible = 1 ORDER BY sort_order ASC';
    const params = categoryId ? [categoryId] : [];
    const res = await d1.query<any>(sql, params);
    return (res.results || []).map((i) => ({
      id: i.id,
      category_id: i.category_id,
      name: i.name,
      slug: i.slug,
      description: i.description || '',
      image_url: i.image_url || '',
      price_paise: Number(i.price_paise || 0),
      pricing_unit: i.pricing_unit || 'per item',
      dimensions: i.dimensions || '',
      specifications: i.specifications || '',
      min_quantity: Number(i.min_quantity || 1),
      default_quantity: Number(i.default_quantity || 10),
      is_visible: Boolean(i.is_visible),
      sort_order: i.sort_order || 0,
    }));
  });
}

/**
 * Returns catering packages from Cloudflare D1.
 */
export async function getCateringPackages(): Promise<CateringPackage[]> {
  const snapshot = getSnapshot();
  if (snapshot) return snapshot.cateringPackages.slice();

  return getCached<CateringPackage[]>('catering_packages', async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM catering_packages WHERE is_visible = 1 ORDER BY sort_order ASC');
    return (res.results || []).map((p) => {
      let features: string[] = [];
      let menu_sections: any[] = [];
      let guest_pricing: any[] = [];
      try { features = JSON.parse(p.features_json || '[]'); } catch {}
      try { menu_sections = JSON.parse(p.menu_sections_json || '[]'); } catch {}
      try { guest_pricing = JSON.parse(p.guest_pricing_json || '[]'); } catch {}
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description || '',
        badge: p.badge || '',
        image_url: p.image_url || '',
        price_per_plate_paise: Number(p.price_per_plate_paise || 0),
        features,
        menu_sections,
        guest_pricing,
        show_on_home: Boolean(p.show_on_home),
        is_visible: Boolean(p.is_visible),
        sort_order: p.sort_order || 0,
      };
    });
  });
}

export async function getCateringPackageBySlug(slug: string): Promise<CateringPackage | null> {
  const all = await getCateringPackages();
  return all.find((p) => p.slug === slug) || null;
}

/**
 * Returns gallery categories and items from Cloudflare D1.
 */
export async function getGalleryCategories(): Promise<GalleryCategory[]> {
  const snapshot = getSnapshot();
  if (snapshot) return snapshot.galleryCategories.slice();

  return getCached<GalleryCategory[]>('gallery_categories', async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM gallery_categories WHERE is_visible = 1 ORDER BY sort_order ASC');
    return (res.results || []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sort_order: c.sort_order || 0,
      is_visible: Boolean(c.is_visible),
    }));
  });
}

export async function getGalleryItems(categorySlug?: string): Promise<GalleryItem[]> {
  const snapshot = getSnapshot();
  if (snapshot) {
    const items =
      categorySlug && categorySlug !== 'all'
        ? snapshot.galleryItems.filter((item) => item.category_slug === categorySlug)
        : snapshot.galleryItems;
    return items.slice();
  }

  return getCached<GalleryItem[]>(`gallery_items:${categorySlug ?? 'all'}`, async () => {
    const d1 = getD1Client();
    let sql = `
      SELECT gi.*, gc.slug as category_slug
      FROM gallery_items gi
      JOIN gallery_categories gc ON gi.category_id = gc.id
      WHERE gi.is_visible = 1 AND gc.is_visible = 1
    `;
    const params: unknown[] = [];
    if (categorySlug && categorySlug !== 'all') {
      sql += ' AND gc.slug = ?';
      params.push(categorySlug);
    }
    sql += ' ORDER BY gi.sort_order ASC, gi.id ASC';

    const res = await d1.query<any>(sql, params);
    return (res.results || []).map((i) => ({
      id: i.id,
      category_id: i.category_id,
      caption: i.caption || '',
      image_url: i.image_url,
      alt_text: i.alt_text || i.caption || '',
      is_visible: Boolean(i.is_visible),
      sort_order: i.sort_order || 0,
      created_at: i.created_at,
    }));
  });
}

/**
 * Returns page-level SEO settings from Cloudflare D1.
 */
export async function getSeoSettings(pageKey: string): Promise<SeoSettings | null> {
  const snapshot = getSnapshot();
  if (snapshot) return snapshot.seo.find((row) => row.page_key === pageKey) ?? null;

  return getCached<SeoSettings | null>(`seo_settings:${pageKey}`, async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM seo_settings WHERE page_key = ? LIMIT 1', [pageKey]);
    const row = res.results?.[0];
    if (!row) return null;
    return {
      id: row.id,
      page_key: row.page_key,
      title: row.title || '',
      description: row.description || '',
      canonical_url: row.canonical_url || '',
      og_image_url: row.og_image_url || '',
    };
  });
}

export const defaultPageContent: Record<string, Omit<PageContent, 'id' | 'created_at' | 'updated_at'>> = {
  home: {
    page_key: 'home',
    title: "Create the Wedding Setup You've Always Imagined.",
    subtitle: 'Mandaps, stage designs, furniture and event equipment — planned and delivered by one Ranchi team.',
    description: 'Choose what you love, add your dimensions and send a single, complete requirement.',
    banner_image_url: '/storage/assets/banners/homepage/banner-hero.webp',
    banner_enabled: true,
    content_json: {
      badge: 'Wedding Planning · Ranchi',
      primaryCta: { label: 'Explore Mandaps', url: '/mandaps' },
      secondaryCta: { label: 'Plan Your Event', url: '/plan' },
      overlay: 'dark',
      textAlignment: 'left',
    },
    seo_title: 'Event Point Ranchi | Wedding Mandaps, Stage Designs & Event Equipment in Ranchi',
    seo_description: 'Wedding mandap, stage design, furniture and event equipment planning in Ranchi.',
    og_image_url: '/storage/assets/banners/homepage/banner-hero.webp',
    published: true,
  },
  mandaps: {
    page_key: 'mandaps',
    title: 'Wedding Mandaps, Designed Around You',
    subtitle: 'Every mandap has clear standard dimensions, honest material specifications and the option to request a custom size.',
    description: 'Add your favourites to an event requirement for a tailored quotation.',
    banner_image_url: '/storage/assets/banners/mandaps/banner-hero.webp',
    banner_enabled: true,
    content_json: {
      badge: 'MANDAP COLLECTION',
      overlay: 'dark',
      textAlignment: 'left',
      chips: [
        { icon: 'archway', text: '6 signature concepts' },
        { icon: 'edit', text: 'Custom L × W × H' },
        { icon: 'shield', text: 'Enquiry, not instant booking' },
      ],
    },
    seo_title: 'Wedding Mandap Designs | Event Point Ranchi',
    seo_description: 'Browse handcrafted traditional and contemporary wedding mandaps in Ranchi.',
    og_image_url: '/storage/assets/banners/mandaps/banner-hero.webp',
    published: true,
  },
  gallery: {
    page_key: 'gallery',
    title: 'Moments At Event Point Ranchi',
    subtitle: 'Mandap details, stage settings and celebrations styled by our Ranchi team.',
    description: 'Explore our portfolio of mandaps, stages, furniture and decor setups across Ranchi.',
    banner_image_url: '/storage/assets/banners/gallery/banner-hero.webp',
    banner_enabled: true,
    content_json: {
      badge: 'THE COLLECTION',
      overlay: 'dark',
      textAlignment: 'left',
    },
    seo_title: 'Wedding Setup Gallery | Event Point Ranchi',
    seo_description: 'Explore our portfolio of mandaps, stages and decor in Ranchi.',
    og_image_url: '/storage/assets/banners/gallery/banner-hero.webp',
    published: true,
  },
  catering: {
    page_key: 'catering',
    title: 'Royal Wedding Catering Packages',
    subtitle: 'Curated menus for weddings, sangeets, and grand receptions in Ranchi.',
    description: 'Pure vegetarian and royal wedding feast menus curated in Ranchi.',
    banner_image_url: '/storage/assets/banners/catering/banner-hero.webp',
    banner_enabled: true,
    content_json: {
      badge: 'CATERING PACKAGES',
      overlay: 'dark',
      textAlignment: 'left',
    },
    seo_title: 'Wedding Catering Packages | Event Point Ranchi',
    seo_description: 'Pure vegetarian and royal wedding feast menus curated in Ranchi.',
    og_image_url: '/storage/assets/banners/catering/banner-hero.webp',
    published: true,
  },
  stages: {
    page_key: 'stages',
    title: 'Reception & Ceremony Stages',
    subtitle: 'Statement backdrops, layered florals and lighting designed for photographs and guest sightlines.',
    description: 'Every design lists its standard footprint and styling details.',
    banner_image_url: '/storage/assets/banners/stages/banner-hero.webp',
    banner_enabled: true,
    content_json: {
      badge: 'STAGE DESIGNS',
      overlay: 'dark',
      textAlignment: 'left',
      chips: [
        { icon: 'theater', text: '6 distinct styles' },
        { icon: 'edit', text: 'Custom dimensions' },
        { icon: 'camera', text: 'Photo-first layouts' },
      ],
    },
    seo_title: 'Wedding & Reception Stage Designs | Event Point Ranchi',
    seo_description: 'Exquisite reception, engagement and wedding stage decorations in Ranchi.',
    og_image_url: '/storage/assets/banners/stages/banner-hero.webp',
    published: true,
  },
  equipment: {
    page_key: 'equipment',
    title: 'Furniture & Event Equipment',
    subtitle: 'Build a practical equipment list with quantities, finishes and specifications.',
    description: 'Add items to your requirements, then send the complete brief to our Ranchi planning team.',
    banner_image_url: '/storage/assets/banners/equipment/banner-hero.webp',
    banner_enabled: true,
    content_json: {
      badge: 'EQUIPMENT CATALOGUE',
      overlay: 'dark',
      textAlignment: 'left',
      chips: [
        { icon: 'chair', text: '6 categories' },
        { icon: 'box', text: 'Quantity-based' },
        { icon: 'receipt', text: 'Quotation enquiry' },
      ],
    },
    seo_title: 'Furniture & Event Equipment Hire | Event Point Ranchi',
    seo_description: 'Chairs, banquet tables, lounge sofas, sound and lighting setup in Ranchi.',
    og_image_url: '/storage/assets/banners/equipment/banner-hero.webp',
    published: true,
  },
};

/**
 * Raw site_settings row for the admin Content Studio. Uses the shared content
 * cache (invalidated by saveSiteSettings), so repeat tab loads cost no D1 trip.
 */
export async function getSiteSettingsRowCached(): Promise<Record<string, any> | null> {
  return getCached<Record<string, any> | null>('admin:site_settings_row', async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM site_settings WHERE id = ? LIMIT 1', ['global']);
    return res.results?.[0] ?? null;
  });
}

/** Raw seo_settings rows for the admin Content Studio (cached; invalidated on writes). */
export async function getSeoSettingsRowsCached(): Promise<Array<Record<string, any>>> {
  return getCached<Array<Record<string, any>>>('admin:seo_settings_rows', async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM seo_settings ORDER BY page_key ASC');
    return res.results || [];
  });
}

function pageContentFallback(pageKey: string): Omit<PageContent, 'id' | 'created_at' | 'updated_at'> {
  return defaultPageContent[pageKey] || {
    page_key: pageKey,
    title: pageKey.charAt(0).toUpperCase() + pageKey.slice(1),
    subtitle: '',
    description: '',
    banner_image_url: '',
    banner_enabled: true,
    content_json: {},
    seo_title: '',
    seo_description: '',
    og_image_url: '',
    published: true,
  };
}

/**
 * Merges a raw page_content row (string or parsed JSON) with its fallback.
 * Pure, so the snapshot path and the live D1 path produce identical output.
 */
export function mergePageContentRow(
  row: Record<string, any>,
  fallback: Omit<PageContent, 'id' | 'created_at' | 'updated_at'>,
): PageContent {
  let parsedContentJson: Record<string, any> = {};
  if (typeof row.content_json === 'string') {
    try {
      parsedContentJson = JSON.parse(row.content_json || '{}');
    } catch {}
  } else if (row.content_json && typeof row.content_json === 'object') {
    parsedContentJson = row.content_json;
  }

  return {
    id: row.id ?? 0,
    page_key: row.page_key || fallback.page_key,
    title: row.title || fallback.title,
    subtitle: row.subtitle || fallback.subtitle,
    description: row.description || fallback.description,
    banner_image_url:
      row.banner_image_url !== undefined && row.banner_image_url !== ''
        ? row.banner_image_url
        : fallback.banner_image_url,
    banner_enabled: Boolean(row.banner_enabled ?? 1),
    content_json: { ...fallback.content_json, ...parsedContentJson },
    seo_title: row.seo_title || fallback.seo_title,
    seo_description: row.seo_description || fallback.seo_description,
    og_image_url: row.og_image_url || fallback.og_image_url,
    published: Boolean(row.published ?? 1),
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

export async function getPageContent(pageKey: string, preview = false): Promise<PageContent> {
  const snapshot = preview ? null : getSnapshot();
  if (snapshot) {
    const row = snapshot.pages.find((page) => page.page_key === pageKey);
    return mergePageContentRow(row ?? {}, pageContentFallback(pageKey));
  }

  return getCached<PageContent>(
    `page_content:${pageKey}:${preview}`,
    async () => {
      const fallback = pageContentFallback(pageKey);

      try {
        const d1 = getD1Client();
        const res = await d1.query<any>(
          preview
            ? 'SELECT * FROM page_content WHERE page_key = ? LIMIT 1'
            : 'SELECT * FROM page_content WHERE page_key = ? AND published = 1 LIMIT 1',
          [pageKey],
        );
        const row = res.results?.[0];
        if (row) return mergePageContentRow(row, fallback);
      } catch (err) {
        console.warn(`[D1] getPageContent(${pageKey}) error, using fallback:`, (err as Error).message);
      }

      return {
        id: 0,
        ...fallback,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    preview,
  );
}

export async function listAllPageContent(preview = false): Promise<PageContent[]> {
  const keys = ['home', 'mandaps', 'gallery', 'catering', 'stages', 'equipment'];
  return Promise.all(keys.map((k) => getPageContent(k, preview)));
}

export async function savePageContent(
  pageKey: string,
  data: {
    title?: string;
    subtitle?: string;
    description?: string;
    banner_image_url?: string;
    banner_enabled?: boolean;
    content_json?: Record<string, any>;
    seo_title?: string;
    seo_description?: string;
    og_image_url?: string;
    published?: boolean;
  },
): Promise<void> {
  const d1 = getD1Client();
  const existing = await getPageContent(pageKey, true);

  const title = data.title !== undefined ? data.title : existing.title;
  const subtitle = data.subtitle !== undefined ? data.subtitle : existing.subtitle;
  const description = data.description !== undefined ? data.description : existing.description;
  const banner_image_url = data.banner_image_url !== undefined ? data.banner_image_url : existing.banner_image_url;
  const banner_enabled = data.banner_enabled !== undefined ? (data.banner_enabled ? 1 : 0) : (existing.banner_enabled ? 1 : 0);
  const content_json = data.content_json !== undefined ? JSON.stringify(data.content_json) : JSON.stringify(existing.content_json);
  const seo_title = data.seo_title !== undefined ? data.seo_title : existing.seo_title;
  const seo_description = data.seo_description !== undefined ? data.seo_description : existing.seo_description;
  const og_image_url = data.og_image_url !== undefined ? data.og_image_url : existing.og_image_url;
  const published = data.published !== undefined ? (data.published ? 1 : 0) : (existing.published ? 1 : 0);

  await d1.query(
    `INSERT INTO page_content (
      page_key, title, subtitle, description, banner_image_url, banner_enabled,
      content_json, seo_title, seo_description, og_image_url, published, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (page_key) DO UPDATE SET
      title = excluded.title,
      subtitle = excluded.subtitle,
      description = excluded.description,
      banner_image_url = excluded.banner_image_url,
      banner_enabled = excluded.banner_enabled,
      content_json = excluded.content_json,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description,
      og_image_url = excluded.og_image_url,
      published = excluded.published,
      updated_at = datetime('now')`,
    [
      pageKey,
      title,
      subtitle,
      description,
      banner_image_url,
      banner_enabled,
      content_json,
      seo_title,
      seo_description,
      og_image_url,
      published,
    ],
  );

  // Keep seo_settings in sync
  await d1.query(
    `INSERT INTO seo_settings (page_key, title, description, og_image_url, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (page_key) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       og_image_url = excluded.og_image_url,
       updated_at = datetime('now')`,
    [pageKey, seo_title || title, seo_description || subtitle, og_image_url || banner_image_url],
  );

  invalidateContentCache();
}

export function validateCoordinates(lat: number | null | undefined, lon: number | null | undefined): { valid: boolean; error?: string } {
  if (lat !== null && lat !== undefined && !Number.isNaN(lat)) {
    if (lat < -90 || lat > 90) {
      return { valid: false, error: 'Latitude must be between -90 and 90 degrees.' };
    }
  }
  if (lon !== null && lon !== undefined && !Number.isNaN(lon)) {
    if (lon < -180 || lon > 180) {
      return { valid: false, error: 'Longitude must be between -180 and 180 degrees.' };
    }
  }
  return { valid: true };
}

export function validateExternalUrl(url: string | null | undefined): boolean {
  if (!url || url.trim() === '') return true;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function saveMandapLocation(
  id: number,
  data: {
    location_name?: string;
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    google_maps_url?: string;
    directions_url?: string;
    show_location?: boolean;
  },
): Promise<void> {
  const coordCheck = validateCoordinates(data.latitude, data.longitude);
  if (!coordCheck.valid) {
    throw new Error(coordCheck.error);
  }

  if (data.google_maps_url && !validateExternalUrl(data.google_maps_url)) {
    throw new Error('Google Maps URL must be a valid HTTP or HTTPS link.');
  }

  if (data.directions_url && !validateExternalUrl(data.directions_url)) {
    throw new Error('Directions URL must be a valid HTTP or HTTPS link.');
  }

  const d1 = getD1Client();
  await d1.query(
    `UPDATE mandaps SET
       location_name = COALESCE(?, location_name),
       address = COALESCE(?, address),
       latitude = ?,
       longitude = ?,
       google_maps_url = COALESCE(?, google_maps_url),
       directions_url = COALESCE(?, directions_url),
       show_location = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      data.location_name !== undefined ? data.location_name : null,
      data.address !== undefined ? data.address : null,
      data.latitude !== undefined ? data.latitude : null,
      data.longitude !== undefined ? data.longitude : null,
      data.google_maps_url !== undefined ? data.google_maps_url : null,
      data.directions_url !== undefined ? data.directions_url : null,
      data.show_location !== undefined ? (data.show_location ? 1 : 0) : 0,
      id,
    ],
  );

  invalidateContentCache();
}

/**
 * Validates and extracts video metadata from YouTube, YouTube Shorts, or Instagram Reels URLs.
 */
export function parseVideoUrl(rawUrl: string): ParsedVideoUrl {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      valid: false,
      platform: 'youtube',
      videoId: '',
      aspectRatio: '16:9',
      embedUrl: '',
      defaultThumbnailUrl: '',
      externalWatchUrl: '',
      error: 'Please provide a valid video URL.',
    };
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      valid: false,
      platform: 'youtube',
      videoId: '',
      aspectRatio: '16:9',
      embedUrl: '',
      defaultThumbnailUrl: '',
      externalWatchUrl: '',
      error: 'Invalid URL format.',
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const pathname = parsed.pathname;

  // 1. YouTube & YouTube Shorts
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    // Check for YouTube Shorts: /shorts/{id}
    const shortsMatch = pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) {
      const videoId = shortsMatch[1];
      return {
        valid: true,
        platform: 'youtube_shorts',
        videoId,
        aspectRatio: '9:16',
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&loop=1`,
        defaultThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        externalWatchUrl: `https://www.youtube.com/shorts/${videoId}`,
      };
    }

    // Check for standard YouTube watch: ?v={id}
    if (pathname === '/watch' || pathname === '/watch_popup') {
      const videoId = parsed.searchParams.get('v');
      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return {
          valid: true,
          platform: 'youtube',
          videoId,
          aspectRatio: '16:9',
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`,
          defaultThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          externalWatchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }
    }

    // Check for youtu.be/{id}
    if (host === 'youtu.be') {
      const shortId = pathname.slice(1).split('/')[0];
      if (shortId && /^[a-zA-Z0-9_-]{11}$/.test(shortId)) {
        return {
          valid: true,
          platform: 'youtube',
          videoId: shortId,
          aspectRatio: '16:9',
          embedUrl: `https://www.youtube-nocookie.com/embed/${shortId}?autoplay=1&rel=0`,
          defaultThumbnailUrl: `https://i.ytimg.com/vi/${shortId}/hqdefault.jpg`,
          externalWatchUrl: `https://www.youtube.com/watch?v=${shortId}`,
        };
      }
    }

    // Check for /embed/{id} or /v/{id}
    const embedMatch = pathname.match(/^\/(embed|v)\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      const videoId = embedMatch[2];
      return {
        valid: true,
        platform: 'youtube',
        videoId,
        aspectRatio: '16:9',
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`,
        defaultThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        externalWatchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }

    return {
      valid: false,
      platform: 'youtube',
      videoId: '',
      aspectRatio: '16:9',
      embedUrl: '',
      defaultThumbnailUrl: '',
      externalWatchUrl: '',
      error: 'Could not extract valid 11-character YouTube video ID.',
    };
  }

  // 2. Instagram Reels: /reel/{code}, /reels/{code}, /p/{code}
  if (host === 'instagram.com') {
    const reelMatch = pathname.match(/^\/(reel|reels|p)\/([a-zA-Z0-9_-]+)/);
    if (reelMatch) {
      const videoId = reelMatch[2];
      return {
        valid: true,
        platform: 'instagram_reels',
        videoId,
        aspectRatio: '9:16',
        embedUrl: `https://www.instagram.com/reel/${videoId}/embed/`,
        defaultThumbnailUrl: '',
        externalWatchUrl: `https://www.instagram.com/reel/${videoId}/`,
      };
    }

    return {
      valid: false,
      platform: 'instagram_reels',
      videoId: '',
      aspectRatio: '9:16',
      embedUrl: '',
      defaultThumbnailUrl: '',
      externalWatchUrl: '',
      error: 'Could not extract valid Instagram Reel or post code.',
    };
  }

  return {
    valid: false,
    platform: 'youtube',
    videoId: '',
    aspectRatio: '16:9',
    embedUrl: '',
    defaultThumbnailUrl: '',
    externalWatchUrl: '',
    error: 'Unsupported platform. Please provide a YouTube video, YouTube Shorts, or Instagram Reel URL.',
  };
}

/**
 * Returns video previews from Cloudflare D1 with optional filtering.
 */
export async function getVideoPreviews(options?: {
  platform?: VideoPlatform;
  onlyPublished?: boolean;
  featuredOnly?: boolean;
  limit?: number;
}): Promise<VideoPreviewItem[]> {
  const onlyPublished = options?.onlyPublished !== false;
  const snapshot = onlyPublished ? getSnapshot() : null;
  if (snapshot) {
    let videos = snapshot.videos;
    if (options?.featuredOnly) videos = videos.filter((video) => video.is_featured);
    if (options?.platform) videos = videos.filter((video) => video.platform === options.platform);
    if (options?.limit && options.limit > 0) videos = videos.slice(0, options.limit);
    return videos.slice();
  }

  const cacheKey = `video_previews:${options?.platform ?? 'all'}:${onlyPublished}:${options?.featuredOnly ?? false}:${options?.limit ?? 'all'}`;

  return getCached<VideoPreviewItem[]>(cacheKey, async () => {
    const d1 = getD1Client();
    let sql = 'SELECT * FROM video_previews WHERE 1=1';
    const params: unknown[] = [];

    if (onlyPublished) {
      sql += ' AND is_published = 1';
    }

    if (options?.featuredOnly) {
      sql += ' AND is_featured = 1';
    }

    if (options?.platform) {
      sql += ' AND platform = ?';
      params.push(options.platform);
    }

    sql += ' ORDER BY sort_order ASC, id DESC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const res = await d1.query<any>(sql, params);
    return (res.results || []).map((row) => ({
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      platform: row.platform as VideoPlatform,
      video_url: row.video_url || '',
      video_id: row.video_id || '',
      thumbnail_url: row.thumbnail_url || '',
      aspect_ratio: (row.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16',
      is_featured: Boolean(row.is_featured),
      is_published: Boolean(row.is_published),
      sort_order: Number(row.sort_order || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  });
}

/**
 * Returns a single video preview by ID.
 */
export async function getVideoPreviewById(id: number): Promise<VideoPreviewItem | null> {
  const d1 = getD1Client();
  const res = await d1.query<any>('SELECT * FROM video_previews WHERE id = ? LIMIT 1', [id]);
  const row = res.results?.[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    platform: row.platform as VideoPlatform,
    video_url: row.video_url || '',
    video_id: row.video_id || '',
    thumbnail_url: row.thumbnail_url || '',
    aspect_ratio: (row.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16',
    is_featured: Boolean(row.is_featured),
    is_published: Boolean(row.is_published),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Saves or updates a video preview in Cloudflare D1.
 */
export async function saveVideoPreview(data: {
  id?: number;
  title: string;
  description?: string;
  platform?: VideoPlatform;
  video_url: string;
  video_id?: string;
  thumbnail_url?: string;
  aspect_ratio?: '16:9' | '9:16';
  is_featured?: boolean;
  is_published?: boolean;
  sort_order?: number;
}): Promise<{ id: number }> {
  if (!data.title || data.title.trim() === '') {
    throw new Error('Title is required for video preview.');
  }
  if (!data.video_url || data.video_url.trim() === '') {
    throw new Error('Video URL is required.');
  }

  // Parse and validate URL
  const parsed = parseVideoUrl(data.video_url);
  if (!parsed.valid) {
    throw new Error(parsed.error || 'Invalid video URL.');
  }

  const platform = data.platform || parsed.platform;
  const videoId = data.video_id || parsed.videoId;
  const aspectRatio = data.aspect_ratio || parsed.aspectRatio;
  const thumbnailUrl = data.thumbnail_url || parsed.defaultThumbnailUrl;
  const isFeatured = data.is_featured ? 1 : 0;
  const isPublished = data.is_published !== undefined ? (data.is_published ? 1 : 0) : 1;
  const sortOrder = data.sort_order ?? 0;
  const description = data.description ?? '';

  const d1 = getD1Client();

  if (data.id) {
    await d1.query(
      `UPDATE video_previews SET
         title = ?,
         description = ?,
         platform = ?,
         video_url = ?,
         video_id = ?,
         thumbnail_url = ?,
         aspect_ratio = ?,
         is_featured = ?,
         is_published = ?,
         sort_order = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        data.title.trim(),
        description.trim(),
        platform,
        data.video_url.trim(),
        videoId,
        thumbnailUrl.trim(),
        aspectRatio,
        isFeatured,
        isPublished,
        sortOrder,
        data.id,
      ],
    );
    invalidateContentCache();
    return { id: data.id };
  } else {
    const res = await d1.query(
      `INSERT INTO video_previews (
         title, description, platform, video_url, video_id, thumbnail_url,
         aspect_ratio, is_featured, is_published, sort_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        data.title.trim(),
        description.trim(),
        platform,
        data.video_url.trim(),
        videoId,
        thumbnailUrl.trim(),
        aspectRatio,
        isFeatured,
        isPublished,
        sortOrder,
      ],
    );
    invalidateContentCache();
    const id = res.meta?.last_row_id || 0;
    return { id };
  }
}

/**
 * Deletes a video preview from Cloudflare D1.
 */
export async function deleteVideoPreview(id: number): Promise<void> {
  const d1 = getD1Client();
  await d1.query('DELETE FROM video_previews WHERE id = ?', [id]);
  invalidateContentCache();
}

/**
 * Toggles a video preview publish status in Cloudflare D1.
 */
export async function toggleVideoPreview(id: number): Promise<boolean> {
  const d1 = getD1Client();
  const current = await d1.query<any>('SELECT is_published FROM video_previews WHERE id = ? LIMIT 1', [id]);
  const row = current.results?.[0];
  if (!row) throw new Error('Video preview not found.');
  const nextVal = row.is_published ? 0 : 1;
  await d1.query("UPDATE video_previews SET is_published = ?, updated_at = datetime('now') WHERE id = ?", [
    nextVal,
    id,
  ]);
  invalidateContentCache();
  return Boolean(nextVal);
}
