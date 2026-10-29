import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './src/core/sanity/schemas';

const projectId =
  process.env.PUBLIC_SANITY_PROJECT_ID ||
  process.env.SANITY_PROJECT_ID ||
  'placeholder-project-id';

const dataset =
  process.env.PUBLIC_SANITY_DATASET ||
  process.env.SANITY_DATASET ||
  'production';

export default defineConfig({
  name: 'event-point-ranchi',
  title: 'Event Point Ranchi Studio',
  projectId,
  dataset,
  basePath: '/admin/studio',
  plugins: [structureTool()],
  schema: {
    types: schemaTypes,
  },
});
