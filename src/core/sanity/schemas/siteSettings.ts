import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Business Name',
      type: 'string',
      initialValue: 'Event Point Ranchi',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'legalName',
      title: 'Legal Business Name',
      type: 'string',
      initialValue: 'Event Point Ranchi',
    }),
    defineField({
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
      initialValue: 'Wedding Mandap, Stage Designs, Furniture & Event Equipment Planning',
    }),
    defineField({
      name: 'shortDescription',
      title: 'Short Description',
      type: 'text',
      rows: 3,
      initialValue: 'Wedding mandaps, stage designs, furniture and event equipment planning in Ranchi, Jharkhand.',
    }),
    defineField({
      name: 'logoFilebaseUrl',
      title: 'Logo Image URL / Filebase Path',
      description: 'Reference to Filebase object path (e.g. /storage/assets/branding/logo.png) or full URL',
      type: 'string',
      initialValue: '/images/event-point-logo.svg',
    }),
    defineField({
      name: 'logoImage',
      title: 'Logo Image (Sanity Asset)',
      description: 'Upload directly if not using Filebase',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'favicon',
      title: 'Favicon URL / Filebase Path',
      type: 'string',
      initialValue: '/images/event-point-logo.svg',
    }),
    defineField({
      name: 'phone',
      title: 'Contact Phone',
      type: 'string',
      initialValue: '+91 98765 43210',
    }),
    defineField({
      name: 'whatsapp',
      title: 'WhatsApp Number (with country code, no + or spaces)',
      type: 'string',
      initialValue: '919876543210',
    }),
    defineField({
      name: 'email',
      title: 'Contact Email',
      type: 'string',
      initialValue: 'info@eventpointranchi.com',
    }),
    defineField({
      name: 'address',
      title: 'Business Address',
      type: 'string',
      initialValue: 'Event Point, Main Road, Ranchi, Jharkhand 834001, India',
    }),
    defineField({
      name: 'venueAddress',
      title: 'Venue Area',
      type: 'string',
      initialValue: 'Main Road, Ranchi (Jharkhand)',
    }),
    defineField({
      name: 'businessHours',
      title: 'Business Hours',
      type: 'string',
      initialValue: 'Daily, 10:00 – 19:00',
    }),
    defineField({
      name: 'socialLinks',
      title: 'Social Media Links',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'platform', title: 'Platform Name', type: 'string' }),
            defineField({ name: 'url', title: 'URL', type: 'url' }),
          ],
        },
      ],
      initialValue: [
        { platform: 'Facebook', url: 'https://facebook.com' },
        { platform: 'Instagram', url: 'https://instagram.com' },
        { platform: 'YouTube', url: 'https://youtube.com' },
        { platform: 'Pinterest', url: 'https://pinterest.com' },
      ],
    }),
    defineField({
      name: 'theme',
      title: 'Theme & Typography',
      type: 'object',
      fields: [
        defineField({
          name: 'primaryColor',
          title: 'Primary Brand Color',
          type: 'string',
          initialValue: '#721224',
        }),
        defineField({
          name: 'goldBright',
          title: 'Accent Gold Color',
          type: 'string',
          initialValue: '#e0b868',
        }),
        defineField({
          name: 'fontPreset',
          title: 'Typography Preset',
          type: 'string',
          options: {
            list: [
              { title: 'Royal Heritage (Cormorant Garamond & Inter)', value: 'heritage' },
              { title: 'Contemporary Luxe (Playfair Display & Inter)', value: 'contemporary' },
              { title: 'Clean Modern (Inter Sans)', value: 'modern' },
            ],
          },
          initialValue: 'heritage',
        }),
      ],
    }),
    defineField({
      name: 'seo',
      title: 'Default SEO Metadata',
      type: 'object',
      fields: [
        defineField({
          name: 'defaultTitle',
          title: 'Default Page Title',
          type: 'string',
          initialValue: 'Event Point Ranchi | Wedding Mandaps, Stage Designs & Event Equipment',
        }),
        defineField({
          name: 'defaultDescription',
          title: 'Default Meta Description',
          type: 'text',
          rows: 3,
          initialValue:
            'Wedding mandap, stage designs, furniture and event equipment planning in Ranchi. Build your requirements and request a quotation from Event Point Ranchi.',
        }),
        defineField({
          name: 'ogImageFilebaseUrl',
          title: 'Open Graph Image (Filebase Path or URL)',
          type: 'string',
          initialValue: '/storage/assets/banners/homepage/banner-hero.webp',
        }),
        defineField({
          name: 'ogImage',
          title: 'Open Graph Image (Sanity Asset)',
          type: 'image',
          options: { hotspot: true },
        }),
      ],
    }),
  ],
});
