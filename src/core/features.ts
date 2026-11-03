/**
 * Server-only feature flags.
 *
 * Payment integration is dormant during the core launch. Do not import this
 * module from client-side code: the flag must never be inlined into browser
 * bundles or exposed as a public build-time value.
 */
export function paymentsEnabled(): boolean {
  return typeof process !== 'undefined' && process.env.PAYMENTS_ENABLED === 'true';
}
