import { getSnapshot } from './snapshot';
import { getMandaps, getStages } from './service';
import type { PublicContentSnapshot } from './snapshot-types';

export interface StaticPathEntry {
  params: { slug: string };
}

export function staticPathsForSlugs(slugs: string[]): StaticPathEntry[] {
  return [...new Set(slugs)].map((slug) => ({ params: { slug } }));
}

/** Pure helper so the static path shape can be unit tested without D1. */
export function snapshotStaticPaths(snapshot: PublicContentSnapshot): {
  mandaps: StaticPathEntry[];
  stages: StaticPathEntry[];
} {
  return {
    mandaps: staticPathsForSlugs(snapshot.mandaps.map((mandap) => mandap.slug)),
    stages: staticPathsForSlugs(snapshot.stages.map((stage) => stage.slug)),
  };
}

/**
 * Static paths for prerendered detail pages. Snapshot slugs are used at build
 * time on Vercel; local builds without a snapshot fall back to live D1.
 */
export async function mandapStaticPaths(): Promise<StaticPathEntry[]> {
  const snapshot = getSnapshot();
  if (snapshot) return snapshotStaticPaths(snapshot).mandaps;
  return staticPathsForSlugs((await getMandaps()).map((mandap) => mandap.slug));
}

export async function stageStaticPaths(): Promise<StaticPathEntry[]> {
  const snapshot = getSnapshot();
  if (snapshot) return snapshotStaticPaths(snapshot).stages;
  return staticPathsForSlugs((await getStages()).map((stage) => stage.slug));
}
