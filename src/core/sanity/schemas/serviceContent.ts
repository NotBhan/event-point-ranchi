import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'serviceContent',
  title: 'Services & Offerings',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Service Title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'badge',
      title: 'Badge (e.g. Signature, Popular)',
      type: 'string',
    }),
    defineField({
      name: 'shortDescription',
      title: 'Short Description',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'fullDescription',
      title: 'Full Presentation Description',
      type: 'text',
      rows: 6,
    }),
    defineField({
      name: 'displayImageFilebaseUrl',
      title: 'Display Image (Filebase URL or Path)',
      description: 'e.g. /storage/assets/halls/1/primary.webp',
      type: 'string',
    }),
    defineField({
      name: 'displayImage',
      title: 'Display Image (Sanity Asset)',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'features',
      title: 'Key Inclusions / Highlights',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({
      name: 'sortOrder',
      title: 'Display Sort Order',
      type: 'number',
      initialValue: 0,
    }),
  ],
});
