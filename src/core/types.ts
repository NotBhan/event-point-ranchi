import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

export type Role = 'customer' | 'admin' | 'superadmin' | 'developer';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  firstName: string;
  role: Role;
  isActive: boolean;
}

export interface AuthState {
  user: SessionUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  isDeveloper: boolean;
}

export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
}

export interface PageContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  form: FormData | null;
  auth: AuthState;
  csrf: string;
  cookies: CookieJar;
}

export interface PageData {
  props?: Record<string, unknown>;
  status?: number;
}

export type PageHandlerResult = PageData | Response;

export interface PageRoute {
  path: string;
  component: AstroComponentFactory;
  handle: (ctx: PageContext) => PageHandlerResult | Promise<PageHandlerResult>;
}

export interface ApiRoute {
  path: string;
  method: HttpMethod | '*';
  handle: (ctx: PageContext) => Response | Promise<Response>;
}

export interface NavItem {
  label: string;
  href: string;
  order?: number;
}

export interface AdminNavItem {
  label: string;
  href: string;
  icon: string;
  order?: number;
}

export interface AppModule {
  id: string;
  label: string;
  enabled?: boolean;
  order?: number;
  nav?: NavItem[];
  adminNav?: AdminNavItem[];
  routes?: PageRoute[];
  api?: ApiRoute[];
}

export interface MatchedPage {
  moduleId: string;
  route: PageRoute;
  params: Record<string, string>;
}

export interface MatchedApi {
  moduleId: string;
  route: ApiRoute;
  params: Record<string, string>;
}

export interface FlashMessage {
  type: 'success' | 'error' | 'info';
  message: string;
}

export type Row = Record<string, unknown>;
