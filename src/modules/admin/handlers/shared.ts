import { setError, setSuccess } from '../../../core/flash';
import { getString, json, redirect } from '../../../core/http';
import type { PageContext } from '../../../core/types';

export async function runFormAction(
  ctx: PageContext,
  actions: Record<string, () => unknown | Promise<unknown>>,
  options: { redirectTo: string; successMessage?: string } = { redirectTo: '/admin' },
): Promise<Response> {
  const action = getString(ctx.form, 'action');
  const handler = actions[action];
  const wantsJson = ctx.request.headers.get('accept')?.includes('application/json') ?? false;

  if (!handler) {
    if (wantsJson) return json({ status: 'error', message: 'Unknown action requested.' }, 400);
    setError(ctx.cookies, 'Unknown action requested.');
    return redirect(options.redirectTo);
  }

  try {
    const data = (await handler()) ?? null;
    if (wantsJson) return json({ status: 'ok', data });
    setSuccess(ctx.cookies, options.successMessage ?? 'Changes saved.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    if (wantsJson) return json({ status: 'error', message }, 400);
    setError(ctx.cookies, message);
  }

  return redirect(options.redirectTo);
}
