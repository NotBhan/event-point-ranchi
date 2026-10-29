export const siteSettingsQuery = `*[_type == "siteSettings"][0]{
  name,
  legalName,
  tagline,
  shortDescription,
  logoFilebaseUrl,
  logoImage {
    asset->{
      _id,
      url
    }
  },
  favicon,
  phone,
  whatsapp,
  email,
  address,
  venueAddress,
  businessHours,
  socialLinks[] {
    platform,
    url
  },
  theme {
    primaryColor,
    goldBright,
    fontPreset
  },
  seo {
    defaultTitle,
    defaultDescription,
    ogImageFilebaseUrl,
    ogImage {
      asset->{
        _id,
        url
      }
    }
  }
}`;

export const homepageQuery = `*[_type == "homepage"][0]{
  heroHeading,
  heroSubtitle,
  heroImageFilebaseUrl,
  heroImage {
    asset->{
      _id,
      url
    }
  },
  primaryCta {
    label,
    url
  },
  secondaryCta {
    label,
    url
  },
  announcementBar {
    enabled,
    text,
    location,
    phone
  },
  features[] {
    icon,
    title,
    description
  },
  steps[] {
    stepNumber,
    title,
    description
  },
  sectionsVisibility {
    mandaps,
    stages,
    equipment,
    catering,
    gallery,
    stats
  },
  promotionalBanner {
    enabled,
    badge,
    headline,
    description,
    ctaLabel,
    ctaUrl
  }
}`;

export const servicesQuery = `*[_type == "serviceContent"] | order(sortOrder asc, _createdAt asc){
  _id,
  title,
  slug,
  badge,
  shortDescription,
  fullDescription,
  displayImageFilebaseUrl,
  displayImage {
    asset->{
      _id,
      url
    }
  },
  features,
  sortOrder
}`;

export const cataloguePresentationsQuery = `*[_type == "cataloguePresentation"]{
  _id,
  itemType,
  referenceSlug,
  customTitle,
  customDescription,
  stylingNotes,
  badge,
  featured,
  sortOrder
}`;

export const galleryPresentationsQuery = `*[_type == "galleryPresentation"]{
  _id,
  categorySlug,
  editorialTitle,
  curatedDescription,
  sortOrder
}`;
