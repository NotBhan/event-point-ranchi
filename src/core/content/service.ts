import { getD1Client } from './d1-client';
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
  RoomOption,
  GalleryCategory,
  GalleryItem,
  SeoSettings,
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
  RoomOption,
  GalleryCategory,
  GalleryItem,
  SeoSettings,
};

// In-memory cache for fast SSR page renders
const contentCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 15_000; // 15-second freshness; instant invalidation on mutation

export function invalidateContentCache(key?: string): void {
  if (key) {
    contentCache.delete(key);
  } else {
    contentCache.clear();
  }
}

async function getCached<T>(key: string, fetcher: () => Promise<T>, skipCache = false): Promise<T> {
  if (!skipCache) {
    const cached = contentCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }
  const fresh = await fetcher();
  contentCache.set(key, { data: fresh, timestamp: Date.now() });
  return fresh;
}

/**
 * Returns merged site settings from Cloudflare D1 with static fallback.
 */
export async function getSiteSettings(preview = false): Promise<MergedSiteSettings> {
  return getCached<MergedSiteSettings>(
    `site_settings:${preview}`,
    async () => {
      try {
        const d1 = getD1Client();
        const res = await d1.query<SiteSettings>('SELECT * FROM site_settings WHERE id = ? LIMIT 1', ['global']);
        const row = res.results?.[0];

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
      } catch (err) {
        console.warn('[D1] getSiteSettings failed, using static config fallback:', (err as Error).message);
      }

      // Static fallback
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
    },
    preview,
  );
}

/**
 * Returns merged homepage content from Cloudflare D1.
 */
export async function getHomepageContent(
  fallbackHeroImage = '/storage/assets/banners/homepage/banner-hero.webp',
  preview = false,
): Promise<MergedHomepageContent> {
  return getCached<MergedHomepageContent>(
    `homepage_content:${preview}`,
    async () => {
      try {
        const d1 = getD1Client();
        const res = await d1.query<HomepageSection>('SELECT * FROM homepage_sections WHERE is_visible = 1 ORDER BY sort_order ASC');
        const sections = res.results || [];

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
  return getCached<MandapItem[]>(
    `mandaps:${preview}`,
    async () => {
      const d1 = getD1Client();
      const mandapsRes = await d1.query<any>(
        preview
          ? 'SELECT * FROM mandaps ORDER BY sort_order ASC'
          : 'SELECT * FROM mandaps WHERE is_visible = 1 ORDER BY sort_order ASC',
      );
      const galleryRes = await d1.query<any>('SELECT * FROM mandap_gallery ORDER BY sort_order ASC');
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
  return getCached<StageItem[]>(
    `stages:${preview}`,
    async () => {
      const d1 = getD1Client();
      const stagesRes = await d1.query<any>(
        preview
          ? 'SELECT * FROM stages ORDER BY sort_order ASC'
          : 'SELECT * FROM stages WHERE is_visible = 1 ORDER BY sort_order ASC',
      );
      const galleryRes = await d1.query<any>('SELECT * FROM stage_gallery ORDER BY sort_order ASC');
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
 * Returns room configuration options from Cloudflare D1 (for enquiry forms).
 */
export async function getRooms(): Promise<RoomOption[]> {
  return getCached<RoomOption[]>('rooms', async () => {
    const d1 = getD1Client();
    const res = await d1.query<any>('SELECT * FROM rooms WHERE is_visible = 1 ORDER BY sort_order ASC');
    return (res.results || []).map((r) => {
      let features: string[] = [];
      try { features = JSON.parse(r.features_json || '[]'); } catch {}
      return {
        id: r.id,
        name: r.name,
        description: r.description || '',
        price_paise: Number(r.price_paise || 0),
        capacity: Number(r.capacity || 1),
        total_rooms: Number(r.total_rooms || 1),
        image_url: r.image_url || '',
        features,
        is_visible: Boolean(r.is_visible),
        sort_order: r.sort_order || 0,
      };
    });
  });
}

/**
 * Returns gallery categories and items from Cloudflare D1.
 */
export async function getGalleryCategories(): Promise<GalleryCategory[]> {
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

export async function getPageContent(pageKey: string, preview = false): Promise<PageContent> {
  return getCached<PageContent>(
    `page_content:${pageKey}:${preview}`,
    async () => {
      const fallback = defaultPageContent[pageKey] || {
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

      try {
        const d1 = getD1Client();
        const res = await d1.query<any>(
          preview
            ? 'SELECT * FROM page_content WHERE page_key = ? LIMIT 1'
            : 'SELECT * FROM page_content WHERE page_key = ? AND published = 1 LIMIT 1',
          [pageKey],
        );
        const row = res.results?.[0];
        if (row) {
          let parsedContentJson: Record<string, any> = {};
          try {
            parsedContentJson = JSON.parse(row.content_json || '{}');
          } catch {}

          return {
            id: row.id,
            page_key: row.page_key,
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
