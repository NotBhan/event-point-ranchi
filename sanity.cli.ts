import { defineCliConfig } from 'sanity/cli';

const projectId =
  process.env.PUBLIC_SANITY_PROJECT_ID ||
  process.env.SANITY_PROJECT_ID ||
  'placeholder-project-id';

const dataset =
  process.env.PUBLIC_SANITY_DATASET ||
  process.env.SANITY_DATASET ||
  'production';

export default defineCliConfig({
  api: {
    projectId,
    dataset,
  },
  studioHost: 'event-point-ranchi',
});
