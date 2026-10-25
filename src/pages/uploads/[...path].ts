import type { APIRoute } from 'astro';
import { dispatchApiRequest } from '../../core/api-dispatch';

export const ALL: APIRoute = (context) => dispatchApiRequest(context);
