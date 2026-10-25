import type {
  AdminNavItem,
  AppModule,
  MatchedApi,
  MatchedPage,
  NavItem,
  PageRoute,
} from './types';

type ModuleFile = { default: AppModule };

const discovered = import.meta.glob<ModuleFile>('/src/modules/*/module.ts', { eager: true });

function disabledModuleIds(): string[] {
  const configured = import.meta.env.DISABLED_MODULES || process.env.DISABLED_MODULES || '';
  return configured
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function normalizePath(path: string): string {
  const clean = path.split('?')[0].replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

function loadModules(): AppModule[] {
  const disabled = new Set(disabledModuleIds());
  const modules = Object.values(discovered)
    .map((entry) => entry.default)
    .filter((module): module is AppModule => Boolean(module?.id))
    .filter((module) => module.enabled !== false && !disabled.has(module.id))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  validate(modules);
  return modules;
}

function validate(modules: AppModule[]): void {
  const pages = new Map<string, string>();
  const apis = new Map<string, string>();

  for (const module of modules) {
    for (const route of module.routes ?? []) {
      const key = normalizePath(route.path);
      const owner = pages.get(key);
      if (owner) {
        throw new Error(`[modules] duplicate page route "${key}" in "${owner}" and "${module.id}"`);
      }
      pages.set(key, module.id);
    }
    for (const route of module.api ?? []) {
      const key = `${route.method.toUpperCase()} ${normalizePath(route.path)}`;
      const owner = apis.get(key);
      if (owner) {
        throw new Error(`[modules] duplicate API route "${key}" in "${owner}" and "${module.id}"`);
      }
      apis.set(key, module.id);
    }
  }
}

export const appModules: AppModule[] = loadModules();

interface CompiledPage {
  moduleId: string;
  route: PageRoute;
  segments: string[];
  specificity: number;
}

interface CompiledApi {
  moduleId: string;
  route: AppModule['api'] extends Array<infer R> | undefined ? R : never;
  segments: string[];
  specificity: number;
  method: string;
}

function segmentsFor(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

function specificity(segments: string[]): number {
  return segments.reduce((score, segment) => (segment.startsWith(':') ? score : score + 1), 0);
}

function compilePages(): CompiledPage[] {
  const compiled: CompiledPage[] = [];
  for (const module of appModules) {
    for (const route of module.routes ?? []) {
      const segments = segmentsFor(route.path);
      compiled.push({
        moduleId: module.id,
        route,
        segments,
        specificity: specificity(segments) * 100 + segments.length,
      });
    }
  }
  return compiled.sort((a, b) => b.specificity - a.specificity);
}

function compileApis(): CompiledApi[] {
  const compiled: CompiledApi[] = [];
  for (const module of appModules) {
    for (const route of module.api ?? []) {
      const segments = segmentsFor(route.path);
      compiled.push({
        moduleId: module.id,
        route: route as CompiledApi['route'],
        segments,
        specificity: specificity(segments) * 100 + segments.length,
        method: route.method.toUpperCase(),
      });
    }
  }
  return compiled.sort((a, b) => b.specificity - a.specificity);
}

const compiledPages = compilePages();
const compiledApis = compileApis();

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};

  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];

    if (segment.startsWith(':') && segment.endsWith('*')) {
      const name = segment.slice(1, -1);
      params[name] = actual.slice(index).map(decodeSegment).join('/');
      return actual.length > index ? params : null;
    }

    if (index >= actual.length) return null;

    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeSegment(actual[index]);
      continue;
    }

    if (segment !== decodeSegment(actual[index])) return null;
  }

  return pattern.length === actual.length ? params : null;
}

export function resolvePage(pathname: string): MatchedPage | null {
  const actual = segmentsFor(pathname);
  for (const candidate of compiledPages) {
    const params = matchSegments(candidate.segments, actual);
    if (params) {
      return { moduleId: candidate.moduleId, route: candidate.route, params };
    }
  }
  return null;
}

export function resolveApi(pathname: string, method: string): MatchedApi | null {
  const actual = segmentsFor(pathname);
  const normalizedMethod = method.toUpperCase();

  for (const candidate of compiledApis) {
    if (candidate.method !== '*' && candidate.method !== normalizedMethod) continue;
    const params = matchSegments(candidate.segments, actual);
    if (params) {
      return { moduleId: candidate.moduleId, route: candidate.route, params };
    }
  }
  return null;
}

export function getNav(): NavItem[] {
  return appModules
    .flatMap((module) => module.nav ?? [])
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getAdminNav(): AdminNavItem[] {
  return appModules
    .flatMap((module) => module.adminNav ?? [])
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getModule(id: string): AppModule | undefined {
  return appModules.find((module) => module.id === id);
}
