import type { APIContext } from 'astro';
import { json } from './http';
import { resolveApi } from './registry';

export async function dispatchApiRequest(context: APIContext): Promise<Response> {
  const matched = resolveApi(context.url.pathname, context.request.method);

  if (!matched) {
    return json({ status: 'error', message: 'Endpoint not found' }, 404);
  }

  try {
    const contentType = context.request.headers.get('content-type') ?? '';
    const form =
      context.request.method === 'POST' && contentType.includes('form')
        ? await context.request.formData()
        : null;

    return await matched.route.handle({
      request: context.request,
      url: context.url,
      params: matched.params,
      form,
      auth: context.locals.auth,
      csrf: context.locals.csrf,
      cookies: context.cookies,
    });
  } catch (error) {
    console.error(`[api] ${context.request.method} ${context.url.pathname} failed`, error);
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return json({ status: 'error', message }, 500);
  }
}
