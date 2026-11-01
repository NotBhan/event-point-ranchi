/**
 * Shared guard for database clients.
 *
 * `npm test` runs with TEST_MODE=1 so a suite can never reach a production
 * database by accident: every client must be pointed at an isolated local file
 * first. Live verification is a separate, explicit command
 * (`npm run test:live`) that sets ALLOW_LIVE_DB_TESTS=1.
 */

export function isTestMode(): boolean {
  return process.env.TEST_MODE === '1' || process.env.NODE_ENV === 'test';
}

export function liveDatabaseAllowed(): boolean {
  return process.env.ALLOW_LIVE_DB_TESTS === '1';
}

/**
 * Throws when a remote database would be opened during a test run without an
 * isolated local path and without the explicit live-test opt-in.
 */
export function assertRemoteDatabaseAllowed(label: string, forceLocal: boolean): void {
  if (forceLocal || !isTestMode() || liveDatabaseAllowed()) return;
  throw new Error(
    `[${label}] Refusing to open the live database during a test run. ` +
      'Import tests/helpers/isolated-db.ts and call the matching useIsolated*() helper before the first query, ' +
      'or set ALLOW_LIVE_DB_TESTS=1 for an explicit live verification.',
  );
}
