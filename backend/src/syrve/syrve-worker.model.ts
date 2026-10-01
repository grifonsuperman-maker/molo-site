import type { SyrveTableLink } from './entities/syrve-table-link.entity';
import type { SyrveSettingsVersion } from './syrve-settings.store';

export const SYRVE_WORKER_INTERVAL_MS = 15_000;
export const SYRVE_WORKER_BUDGET_MS = 45_000;
export const SYRVE_WORKER_MAX_TABLES = 32;
export const SYRVE_WORKER_ERRORS = ['SYRVE_AUTH_FAILED', 'SYRVE_ACCESS_DENIED', 'SYRVE_RATE_LIMITED',
  'SYRVE_TIMEOUT', 'SYRVE_UNAVAILABLE', 'SYRVE_INVALID_RESPONSE', 'SYRVE_ORGANIZATION_UNAVAILABLE',
  'SYRVE_OBSERVATION_LIMIT', 'SYRVE_OBSERVATION_UNKNOWN', 'SYRVE_CONFIGURATION_CHANGED',
  'SYRVE_LOCAL_STATE_CHANGED', 'SYRVE_STATE_INVALID'] as const;
export type SyrveWorkerError = typeof SYRVE_WORKER_ERRORS[number];
export type SyrveWorkerLease = { id: string; version: SyrveSettingsVersion; links: SyrveTableLink[] };
export type SyrveWorkerResult = { status: 'disabled' | 'idle' | 'busy' | 'backoff' | 'observed' | 'stale' | 'stopped' | 'failed';
  processed: number; code?: SyrveWorkerError };
export function workerError(value: unknown): SyrveWorkerError {
  return SYRVE_WORKER_ERRORS.includes(value as SyrveWorkerError) ? value as SyrveWorkerError : 'SYRVE_UNAVAILABLE';
}
export function workerBackoff(failures: number, code: SyrveWorkerError): number {
  const base = code === 'SYRVE_RATE_LIMITED' ? 60_000 : SYRVE_WORKER_INTERVAL_MS;
  return Math.min(300_000, base * 2 ** Math.min(5, Math.max(0, failures - 1)));
}
