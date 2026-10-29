export interface SanityImageReference {
  _type?: 'image';
  asset?: {
    _ref?: string;
    _type?: 'reference';
    url?: string;
  };
  filebaseUrl?: string;
  alt?: string;
}

export interface SanitySocialLink {
  platform: string;
  url: string;
}

export interface SanitySiteSettings {
  name?: string;
  legalName?: string;
  tagline?: string;
  shortDescription?: string;
  logo?: SanityImageReference | string;
  logoFilebaseUrl?: string;
  logoImage?: SanityImageReference;
  favicon?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  venueAddress?: string;
  businessHours?: string;
  socialLinks?: SanitySocialLink[];
  theme?: {
    primaryColor?: string;
    goldBright?: string;
    fontPreset?: string;
  };
  seo?: {
    defaultTitle?: string;
    defaultDescription?: string;
    ogImageFilebaseUrl?: string;
    ogImage?: SanityImageReference | string;
  };
}

export interface SanityFeature {
  icon?: string;
  title?: string;
  description?: string;
}

export interface SanityStep {
  stepNumber?: string;
  title?: string;
  description?: string;
}

export interface SanityCta {
  label?: string;
  url?: string;
}

export interface SanityHomepage {
  heroHeading?: string;
  heroSubtitle?: string;
  heroImageFilebaseUrl?: string;
  heroImage?: SanityImageReference | string;
  primaryCta?: SanityCta;
  secondaryCta?: SanityCta;
  announcementBar?: {
    enabled?: boolean;
    text?: string;
    phone?: string;
    location?: string;
  };
  features?: SanityFeature[];
  steps?: SanityStep[];
  sectionsVisibility?: {
    mandaps?: boolean;
    stages?: boolean;
    equipment?: boolean;
    catering?: boolean;
    gallery?: boolean;
    stats?: boolean;
  };
  promotionalBanner?: {
    enabled?: boolean;
    badge?: string;
    headline?: string;
    description?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  };
}

export interface SanityServiceContent {
  _id: string;
  title: string;
  slug: { current: string };
  badge?: string;
  shortDescription?: string;
  fullDescription?: string;
  displayImage?: SanityImageReference | string;
  features?: string[];
  sortOrder?: number;
}

export interface SanityCataloguePresentation {
  _id: string;
  itemType: 'mandap' | 'stage' | 'equipment' | 'catering' | 'hall' | 'room';
  referenceSlug: string;
  customTitle?: string;
  customDescription?: string;
  stylingNotes?: string;
  badge?: string;
  featured?: boolean;
  sortOrder?: number;
}

export interface SanityGalleryPresentation {
  _id: string;
  categorySlug: string;
  editorialTitle?: string;
  curatedDescription?: string;
  sortOrder?: number;
}
