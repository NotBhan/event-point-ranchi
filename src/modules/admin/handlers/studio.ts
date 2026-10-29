import { requireAdmin } from '../../../core/auth';
import type { PageContext } from '../../../core/types';
import { getSanityConfig, isSanityConfigured } from '../../../core/sanity/config';

export function studioAdmin(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const config = getSanityConfig();
  return {
    props: {
      configured: isSanityConfigured(),
      projectId: config.projectId,
      dataset: config.dataset,
    },
  };
}
