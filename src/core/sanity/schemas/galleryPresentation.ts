import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'galleryPresentation',
  title: 'Gallery Category Presentation',
  type: 'document',
  fields: [
    defineField({
      name: 'categorySlug',
      title: 'Gallery Category Slug',
      description: 'e.g. "mandap-designs", "stage-designs", "furniture-decor", "event-celebrations"',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'editorialTitle',
      title: 'Display Title Override',
      type: 'string',
    }),
    defineField({
      name: 'curatedDescription',
      title: 'Category Editorial Introduction',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'sortOrder',
      title: 'Display Sort Order',
      type: 'number',
      initialValue: 0,
    }),
  ],
});
