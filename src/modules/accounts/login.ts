import { startSession } from '../../core/auth';
import { setSuccess } from '../../core/flash';
import { getPassword, getString, redirect, safeNext } from '../../core/http';
import { RATE_LIMITS, checkRateLimit, rateLimitKey } from '../../core/rate-limit';
import type { PageContext, PageHandlerResult } from '../../core/types';
import {
  authenticateCustomer,
  PUBLIC_LOGIN_ACCOUNT_NOT_FOUND,
  PUBLIC_LOGIN_INVALID_PASSWORD,
} from './service';

export async function handlePublicLogin(ctx: PageContext): Promise<PageHandlerResult> {
  const nextParam = ctx.url.searchParams.get('next') ?? '';

  if (ctx.auth.user) return redirect(safeNext(nextParam, '/'));

  if (ctx.request.method !== 'POST') {
    return { props: { error: null, next: nextParam, username: '' } };
  }

  const limit = checkRateLimit(rateLimitKey(ctx.request, 'login'), RATE_LIMITS.login);
  if (!limit.allowed) {
    return {
      props: {
        error: `Too many sign-in attempts. Please try again in ${limit.retryAfterSeconds} seconds.`,
        next: nextParam,
        username: '',
      },
      status: 429,
    };
  }

  const login = getString(ctx.form, 'username');
  const password = getPassword(ctx.form, 'password');
  const result = await authenticateCustomer(login, password);

  if (result.kind !== 'success') {
    return {
      props: {
        error:
          result.kind === 'invalid-password'
            ? PUBLIC_LOGIN_INVALID_PASSWORD
            : PUBLIC_LOGIN_ACCOUNT_NOT_FOUND,
        next: nextParam,
        username: login,
      },
    };
  }

  const user = result.user;
  startSession(ctx.cookies, user.id, user.password_hash);
  setSuccess(ctx.cookies, `Welcome back, ${user.first_name || user.username}!`);
  const target = getString(ctx.form, 'next') || nextParam;
  return redirect(safeNext(target, '/'));
}
