import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'cataloguePresentation',
  title: 'Catalogue Presentation Overrides',
  type: 'document',
  fields: [
    defineField({
      name: 'itemType',
      title: 'Catalogue Category',
      type: 'string',
      options: {
        list: [
          { title: 'Mandap', value: 'mandap' },
          { title: 'Stage Design', value: 'stage' },
          { title: 'Equipment', value: 'equipment' },
          { title: 'Catering Package', value: 'catering' },
          { title: 'Hall / Banquet', value: 'hall' },
          { title: 'Room / Suite', value: 'room' },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'referenceSlug',
      title: 'Database Item Slug',
      description: 'The exact slug of the catalogue item (e.g. "royal-rajputana-carved-mandap")',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'customTitle',
      title: 'Display Title Override',
      type: 'string',
    }),
    defineField({
      name: 'customDescription',
      title: 'Marketing Description Override',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'stylingNotes',
      title: 'Editorial Styling & Recommendation Notes',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'badge',
      title: 'Promotional Badge (e.g. Signature, Trending, Classic)',
      type: 'string',
    }),
    defineField({
      name: 'featured',
      title: 'Highlight as Featured',
      type: 'boolean',
      initialValue: false,
    }),
    defineField({
      name: 'sortOrder',
      title: 'Editorial Sort Order',
      type: 'number',
      initialValue: 0,
    }),
  ],
});
