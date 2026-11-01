/**
 * Minimal in-memory rate limiter for authentication endpoints.
 *
 * Per server instance only: on Vercel each lambda has its own memory, so this
 * slows down credential stuffing from a single client hitting the same warm
 * instance. It is not a substitute for a shared limiter; documented as such.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitRule {
  /** Maximum attempts inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  register: { limit: 5, windowMs: 15 * 60_000 },
  passwordReset: { limit: 5, windowMs: 15 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - 1 };
  }

  if (bucket.count >= rule.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - bucket.count };
}

/** Client key for rate limiting; prefers the proxy-provided address. */
export function rateLimitKey(request: Request, action: string): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${action}:${ip}`;
}

export function resetRateLimits(): void {
  buckets.clear();
}
