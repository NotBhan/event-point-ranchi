import { defineMiddleware } from 'astro:middleware';
import { getAuth } from './core/auth';
import { csrfMatches, ensureCsrf, submittedCsrfToken } from './core/csrf';
import { getDb } from './core/db';
import { takeFlash } from './core/flash';

export const onRequest = defineMiddleware(async (context, next) => {
  getDb();

  const csrf = ensureCsrf(context.cookies);
  context.locals.csrf = csrf;
  context.locals.auth = await getAuth(context.cookies);
  context.locals.flash = takeFlash(context.cookies);

  const method = context.request.method.toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  if (isMutation) {
    const submitted = await submittedCsrfToken(context.request);
    if (!csrfMatches(submitted, csrf)) {
      return new Response('Invalid or missing CSRF token. Refresh the page and try again.', {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  }

  return next();
});
