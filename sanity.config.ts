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

function resolveBasePath(): string {
  if (process.env.SANITY_STUDIO_BASE_PATH) {
    return process.env.SANITY_STUDIO_BASE_PATH;
  }
  if (typeof window !== 'undefined') {
    if (window.location.pathname.startsWith('/admin/studio')) return '/admin/studio';
    if (window.location.pathname.startsWith('/studio')) return '/studio';
    return '/';
  }
  return '/admin/studio';
}

export default defineConfig({
  name: 'event-point-ranchi',
  title: 'Event Point Ranchi Studio',
  projectId,
  dataset,
  basePath: resolveBasePath(),
  plugins: [structureTool()],
  schema: {
    types: schemaTypes,
  },
});
