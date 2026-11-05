import { randomBytes } from 'node:crypto';

function configuredValue(name: string): string {
  const fromProcess = String(process.env[name] ?? '').trim();
  if (fromProcess) return fromProcess;
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return String(env?.[name] ?? '').trim();
}

function isProduction(): boolean {
  const testMode =
    process.env.TEST_MODE === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true';
  return !testMode && process.env.NODE_ENV === 'production';
}

/**
 * Credentials for privileged seeded accounts are mandatory in production.
 * Development/test keep the documented local fallback for zero-config setup.
 */
export function requiredSeedCredential(name: string, developmentFallback: string): string {
  const value = configuredValue(name);
  if (value) return value;
  if (isProduction()) {
    throw new Error(`${name} must be set before seeding privileged accounts in production.`);
  }
  return developmentFallback;
}

/**
 * Demo-only accounts should never ship with a known production password. If no
 * explicit value is supplied in production, generate an unusable random value
 * instead of silently creating an account with a public default.
 */
export function optionalSeedCredential(name: string, developmentFallback: string): string {
  const value = configuredValue(name);
  if (value) return value;
  if (isProduction()) return randomBytes(32).toString('base64url');
  return developmentFallback;
}
