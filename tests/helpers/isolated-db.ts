/**
 * Test isolation for the operational database.
 *
 * `npm test` runs with TEST_MODE=1, and both database clients refuse to open a
 * remote connection unless a test explicitly imports this helper (which points
 * them at a throwaway SQLite file) or the run is an explicit live verification
 * (`npm run test:live`, which sets ALLOW_LIVE_DB_TESTS=1).
 *
 * Each test file runs in its own process, so one temp directory per file is
 * enough, and leaving the database behind cannot affect another suite.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string | null = null;

function tempRoot(): string {
  if (!root) {
    root = mkdtempSync(join(tmpdir(), 'event-point-test-'));
  }
  return root;
}

/**
 * Points the operational client at an isolated SQLite file for this process.
 * Must run before the first `getNeonClient()` call.
 */
export function useIsolatedOperationalDb(label = 'operational'): string {
  process.env.TEST_MODE = '1';
  const path = join(tempRoot(), `${label}-${process.pid}.db`);
  process.env.OPERATIONAL_DB_LOCAL_PATH = path;
  return path;
}

/**
 * Forces the public-content client onto its local SQLite driver with an
 * isolated data directory.
 */
export function useIsolatedContentDb(): string {
  process.env.TEST_MODE = '1';
  const dataDir = join(tempRoot(), 'data');
  process.env.DATA_DIR = dataDir;
  process.env.D1_LOCAL = '1';
  process.env.APP_SECRET ??= 'test-secret';
  return dataDir;
}

/** Removes the per-process temp root. Safe to call when nothing was created. */
export function cleanupIsolatedDatabases(): void {
  if (!root) return;
  rmSync(root, { recursive: true, force: true });
  root = null;
}

/**
 * True only for an explicit live verification run (`npm run test:live`).
 * Suites that need the real D1/Neon data use this to skip instead of silently
 * reading production during `npm test`.
 */
export function liveDatabaseTestsEnabled(): boolean {
  return process.env.ALLOW_LIVE_DB_TESTS === '1';
}

/** Skip reason for `node:test`, or `false` when live tests are enabled. */
export function liveTestsSkipReason(): false | string {
  return liveDatabaseTestsEnabled()
    ? false
    : 'live database integration test — run `npm run test:live` to include it';
}
