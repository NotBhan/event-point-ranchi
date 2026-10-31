const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutating(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { location } });
}

export function badRequest(message: string): Response {
  return json({ status: 'error', message }, 400);
}

export function forbidden(message = 'Forbidden'): Response {
  return json({ status: 'error', message }, 403);
}

export function notFound(message = 'Not found'): Response {
  return json({ status: 'error', message }, 404);
}

export function methodNotAllowed(): Response {
  return json({ status: 'error', message: 'Method not allowed' }, 405);
}

export function getString(form: FormData | null, name: string): string {
  const value = form?.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function getInt(form: FormData | null, name: string, fallback = 0): number {
  const value = Number.parseInt(getString(form, name), 10);
  return Number.isFinite(value) ? value : fallback;
}

export function getBoolean(form: FormData | null, name: string): boolean {
  return form?.get(name) === 'on' || form?.get(name) === 'true' || form?.get(name) === '1';
}

export function parseMoneyToPaise(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  const raw = String(value ?? '').replace(/[₹,\s]/g, '');
  if (!raw) return 0;
  const amount = Number.parseFloat(raw);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function formatMoney(paise: number | string | null | undefined): string {
  const amount = Number(paise ?? 0) / 100;
  const hasDecimals = Math.abs(amount % 1) > 0.001;
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'To be announced';
  const date =
    value instanceof Date
      ? value
      : new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value instanceof Date ? '—' : value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date
    ? value
    : new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value instanceof Date ? '—' : value;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PaginationState {
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  offset: number;
}

export function parsePageParams(
  source: URL | URLSearchParams,
  options: { defaultPerPage?: number; maxPerPage?: number } = {},
): { page: number; perPage: number; offset: number } {
  const searchParams = source instanceof URL ? source.searchParams : source;
  const defaultPerPage = options.defaultPerPage ?? 25;
  const maxPerPage = options.maxPerPage ?? 100;

  const rawPerPage = Number(searchParams.get('per') ?? '');
  const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0
    ? Math.min(Math.floor(rawPerPage), maxPerPage)
    : defaultPerPage;

  const rawPage = Number(searchParams.get('page') ?? '');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  return { page, perPage, offset: (page - 1) * perPage };
}

export function buildPagination(
  page: number,
  perPage: number,
  totalCount: number,
  itemCount: number,
): PaginationState {
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * perPage;
  return {
    page: currentPage,
    perPage,
    totalCount,
    totalPages,
    offset,
    startItem: totalCount === 0 ? 0 : offset + 1,
    endItem: Math.min(offset + itemCount, totalCount),
  };
}

export function imageUrl(path: string | null | undefined, fallback = '/images/placeholder.jpg'): string {
  if (!path) return fallback;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) return path;
  return `/${path.replace(/^\.?\//, '')}`;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'R';
  return `${parts[0][0] ?? ''}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function uniqueSlug(base: string, exists: (slug: string) => boolean): string {
  const initial = slugify(base) || 'item';
  if (!exists(initial)) return initial;
  let counter = 2;
  while (exists(`${initial}-${counter}`)) counter += 1;
  return `${initial}-${counter}`;
}

/** Async variant for remote slug checks (D1-backed catalog rows). */
export async function uniqueSlugAsync(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const initial = slugify(base) || 'item';
  if (!(await exists(initial))) return initial;
  let counter = 2;
  while (await exists(`${initial}-${counter}`)) counter += 1;
  return `${initial}-${counter}`;
}
