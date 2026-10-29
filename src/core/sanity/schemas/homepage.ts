import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'homepage',
  title: 'Homepage',
  type: 'document',
  fields: [
    defineField({
      name: 'heroHeading',
      title: 'Hero Heading',
      type: 'string',
      initialValue: "Create the Wedding Setup You've Always Imagined.",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'heroSubtitle',
      title: 'Hero Subtitle',
      type: 'text',
      rows: 3,
      initialValue:
        'Mandaps, stage designs, furniture and event equipment — planned and delivered by one Ranchi team. Choose what you love, add your dimensions and send a single, complete requirement.',
    }),
    defineField({
      name: 'heroImageFilebaseUrl',
      title: 'Hero Image (Filebase URL or Path)',
      description: 'Default: /storage/assets/banners/homepage/banner-hero.webp',
      type: 'string',
      initialValue: '/storage/assets/banners/homepage/banner-hero.webp',
    }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image (Sanity Asset)',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'primaryCta',
      title: 'Primary CTA Button',
      type: 'object',
      fields: [
        defineField({ name: 'label', title: 'Button Label', type: 'string', initialValue: 'Explore Mandaps' }),
        defineField({ name: 'url', title: 'Target URL', type: 'string', initialValue: '/mandaps' }),
      ],
    }),
    defineField({
      name: 'secondaryCta',
      title: 'Secondary CTA Button',
      type: 'object',
      fields: [
        defineField({ name: 'label', title: 'Button Label', type: 'string', initialValue: 'Plan Your Event' }),
        defineField({ name: 'url', title: 'Target URL', type: 'string', initialValue: '/plan' }),
      ],
    }),
    defineField({
      name: 'announcementBar',
      title: 'Announcement Bar',
      type: 'object',
      fields: [
        defineField({ name: 'enabled', title: 'Show Announcement Bar', type: 'boolean', initialValue: true }),
        defineField({
          name: 'text',
          title: 'Announcement Message',
          type: 'string',
          initialValue: 'Mandaps, stage designs, furniture & equipment — enquiries are quotations, not automatic bookings',
        }),
        defineField({
          name: 'location',
          title: 'Location Tag',
          type: 'string',
          initialValue: 'Wedding planning across Ranchi & Jharkhand',
        }),
        defineField({
          name: 'phone',
          title: 'Display Phone Number',
          type: 'string',
          initialValue: '+91 98765 43210',
        }),
      ],
    }),
    defineField({
      name: 'features',
      title: 'Featured Value Propositions (4 Cards)',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'icon', title: 'Icon Name', type: 'string', initialValue: 'sparkles' }),
            defineField({ name: 'title', title: 'Feature Title', type: 'string' }),
            defineField({ name: 'description', title: 'Feature Description', type: 'text', rows: 2 }),
          ],
        },
      ],
      initialValue: [
        { icon: 'archway', title: 'Signature Mandaps', description: 'Carved, floral and contemporary mandap concepts built to your dimensions.' },
        { icon: 'theater', title: 'Stage Design Studio', description: 'Reception and ceremony stages styled around your palette and venue.' },
        { icon: 'chair', title: 'Furniture & Equipment', description: 'Chairs, tables, lounge seating, lighting and event essentials in one place.' },
        { icon: 'shield', title: 'One Planning Team', description: 'A single Ranchi-based coordinator from first enquiry to final setup.' },
      ],
    }),
    defineField({
      name: 'steps',
      title: 'How It Works (Planning Steps)',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'stepNumber', title: 'Step Number', type: 'string' }),
            defineField({ name: 'title', title: 'Step Title', type: 'string' }),
            defineField({ name: 'description', title: 'Step Description', type: 'text', rows: 2 }),
          ],
        },
      ],
      initialValue: [
        { stepNumber: '01', title: 'Share your date & venue', description: 'Tell us the event type, date, guest count and location in Ranchi.' },
        { stepNumber: '02', title: 'Select mandap & stage', description: 'Choose a design or request custom dimensions for your venue.' },
        { stepNumber: '03', title: 'Build your equipment list', description: 'Add chairs, tables, lounge seating, lighting and essentials with quantities.' },
        { stepNumber: '04', title: 'Receive a quotation', description: 'Our team checks availability and sends an itemised quotation — not an auto-booking.' },
        { stepNumber: '05', title: 'Confirm in writing', description: 'Dates and stock are held only after you confirm the quotation with us.' },
      ],
    }),
    defineField({
      name: 'sectionsVisibility',
      title: 'Homepage Sections Visibility',
      type: 'object',
      fields: [
        defineField({ name: 'mandaps', title: 'Show Mandaps Section', type: 'boolean', initialValue: true }),
        defineField({ name: 'stages', title: 'Show Stages Section', type: 'boolean', initialValue: true }),
        defineField({ name: 'equipment', title: 'Show Equipment Section', type: 'boolean', initialValue: true }),
        defineField({ name: 'catering', title: 'Show Catering Section', type: 'boolean', initialValue: true }),
        defineField({ name: 'gallery', title: 'Show Gallery Section', type: 'boolean', initialValue: true }),
        defineField({ name: 'stats', title: 'Show Counter Stats', type: 'boolean', initialValue: true }),
      ],
    }),
    defineField({
      name: 'promotionalBanner',
      title: 'Promotional Banner (Optional)',
      type: 'object',
      fields: [
        defineField({ name: 'enabled', title: 'Enable Promotional Banner', type: 'boolean', initialValue: false }),
        defineField({ name: 'badge', title: 'Badge Text', type: 'string', initialValue: 'Special Offer' }),
        defineField({ name: 'headline', title: 'Banner Headline', type: 'string' }),
        defineField({ name: 'description', title: 'Banner Description', type: 'text', rows: 2 }),
        defineField({ name: 'ctaLabel', title: 'CTA Button Text', type: 'string', initialValue: 'Learn More' }),
        defineField({ name: 'ctaUrl', title: 'CTA Target URL', type: 'string', initialValue: '/plan' }),
      ],
    }),
  ],
});
