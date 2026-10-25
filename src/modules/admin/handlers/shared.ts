import { setError, setSuccess } from '../../../core/flash';
import { getString, redirect } from '../../../core/http';
import type { PageContext } from '../../../core/types';

export async function runFormAction(
  ctx: PageContext,
  actions: Record<string, () => void | Promise<void>>,
  options: { redirectTo: string; successMessage?: string } = { redirectTo: '/admin' },
): Promise<Response> {
  const action = getString(ctx.form, 'action');
  const handler = actions[action];

  if (!handler) {
    setError(ctx.cookies, 'Unknown action requested.');
    return redirect(options.redirectTo);
  }

  try {
    await handler();
    setSuccess(ctx.cookies, options.successMessage ?? 'Changes saved.');
  } catch (error) {
    setError(ctx.cookies, error instanceof Error ? error.message : 'Something went wrong.');
  }

  return redirect(options.redirectTo);
}
