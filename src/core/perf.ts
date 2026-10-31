import { AsyncLocalStorage } from 'node:async_hooks';

export type PerfDbKind = 'sqlite' | 'd1' | 'neon';

interface PerfState {
  startedAt: number;
  counts: Record<PerfDbKind, number>;
  dbMs: Record<PerfDbKind, number>;
  marks: Record<string, number>;
  slowQueries: Array<{ kind: PerfDbKind; ms: number; sql: string }>;
}

export interface PerfRequestEntry {
  method: string;
  path: string;
  status: number;
  totalMs: number;
  dbMs: number;
  queries: number;
  at: number;
}

const storage = new AsyncLocalStorage<PerfState>();
const MAX_LOG = 100;

interface PerfGlobalScope {
  __eventPointPerfLog?: PerfRequestEntry[];
}

const globalScope = globalThis as typeof globalThis & PerfGlobalScope;
const requestLog: PerfRequestEntry[] = (globalScope.__eventPointPerfLog ??= []);

export function perfTimingEnabled(): boolean {
  const flag = process.env.PERF_TIMING;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

function slowRequestMs(): number {
  const configured = Number(process.env.PERF_SLOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 250;
}

function slowQueryMs(): number {
  const configured = Number(process.env.PERF_SLOW_QUERY_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 50;
}

function createState(): PerfState {
  return {
    startedAt: performance.now(),
    counts: { sqlite: 0, d1: 0, neon: 0 },
    dbMs: { sqlite: 0, d1: 0, neon: 0 },
    marks: {},
    slowQueries: [],
  };
}

export function runWithPerf<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(createState(), fn);
}

export function currentPerf(): PerfState | undefined {
  return storage.getStore();
}

export function recordDb(kind: PerfDbKind, ms: number, sql = ''): void {
  const state = storage.getStore();
  if (!state) return;
  state.counts[kind] += 1;
  state.dbMs[kind] += ms;

  if (ms >= slowQueryMs()) {
    const snippet = sql.replace(/\s+/g, ' ').trim().slice(0, 160);
    state.slowQueries.push({ kind, ms, sql: snippet });
    if (state.slowQueries.length <= 3) {
      console.warn(`[perf] slow ${kind} query ${ms.toFixed(1)}ms :: ${snippet}`);
    }
  }
}

export function markPerf(name: string, ms: number): void {
  const state = storage.getStore();
  if (!state) return;
  state.marks[name] = (state.marks[name] ?? 0) + ms;
}

export function buildServerTimingHeader(state: PerfState | undefined): string | null {
  if (!state) return null;
  const parts: string[] = [];
  const totalDbMs = state.dbMs.sqlite + state.dbMs.d1 + state.dbMs.neon;
  parts.push(`db;dur=${totalDbMs.toFixed(1)};desc="${state.counts.sqlite + state.counts.d1 + state.counts.neon}q"`);
  if (state.dbMs.d1 > 0) parts.push(`d1;dur=${state.dbMs.d1.toFixed(1)};desc="${state.counts.d1}q"`);
  if (state.dbMs.neon > 0) parts.push(`neon;dur=${state.dbMs.neon.toFixed(1)};desc="${state.counts.neon}q"`);
  for (const [name, ms] of Object.entries(state.marks)) {
    const safe = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (safe) parts.push(`${safe};dur=${ms.toFixed(1)}`);
  }
  return parts.join(', ');
}

export function finishPerfRequest(method: string, path: string, status: number): PerfRequestEntry {
  const state = storage.getStore();
  const totalMs = state ? performance.now() - state.startedAt : 0;
  const entry: PerfRequestEntry = {
    method,
    path,
    status,
    totalMs,
    dbMs: state ? state.dbMs.sqlite + state.dbMs.d1 + state.dbMs.neon : 0,
    queries: state ? state.counts.sqlite + state.counts.d1 + state.counts.neon : 0,
    at: Date.now(),
  };

  requestLog.push(entry);
  if (requestLog.length > MAX_LOG) requestLog.shift();

  if (entry.totalMs >= slowRequestMs()) {
    const breakdown = state
      ? `db=${entry.dbMs.toFixed(1)}ms (${entry.queries}q sqlite=${state.counts.sqlite} d1=${state.counts.d1} neon=${state.counts.neon})`
      : 'no-timing';
    console.warn(`[perf] slow request ${method} ${path} -> ${status} in ${entry.totalMs.toFixed(1)}ms :: ${breakdown}`);
  }

  return entry;
}

export function recentPerfEntries(): PerfRequestEntry[] {
  return [...requestLog];
}
