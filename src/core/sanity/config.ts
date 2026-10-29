export interface SanityConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  useCdn: boolean;
  token?: string;
  previewSecret?: string;
  webhookSecret?: string;
}

export function getSanityConfig(): SanityConfig {
  const env = typeof process !== 'undefined' ? process.env : (import.meta as any).env || {};

  const projectId =
    env.PUBLIC_SANITY_PROJECT_ID ||
    env.SANITY_PROJECT_ID ||
    (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_SANITY_PROJECT_ID) ||
    '';

  const dataset =
    env.PUBLIC_SANITY_DATASET ||
    env.SANITY_DATASET ||
    (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_SANITY_DATASET) ||
    'production';

  const apiVersion =
    env.SANITY_API_VERSION ||
    (typeof import.meta !== 'undefined' && import.meta.env?.SANITY_API_VERSION) ||
    '2025-01-01';

  // Server-only secrets: never exposed to client bundles
  const token = env.SANITY_API_TOKEN || env.SANITY_READ_TOKEN || undefined;
  const previewSecret = env.SANITY_PREVIEW_SECRET || undefined;
  const webhookSecret = env.SANITY_WEBHOOK_SECRET || undefined;

  // Use CDN in production when no token is present; bypass CDN when querying drafts with token
  const useCdn = !token && process.env.NODE_ENV === 'production';

  return {
    projectId,
    dataset,
    apiVersion,
    useCdn,
    token,
    previewSecret,
    webhookSecret,
  };
}

export function isSanityConfigured(): boolean {
  const { projectId, dataset } = getSanityConfig();
  return Boolean(projectId && projectId.trim() !== '' && dataset && dataset.trim() !== '');
}
