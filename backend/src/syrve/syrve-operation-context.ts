import { AsyncLocalStorage } from 'async_hooks';

// Long operations wait asynchronously for the shared quota. Each HTTP request
// still has its own 12-second timeout; no SQL transaction spans that wait.
export const SYRVE_OPERATION_BUDGET_MS = 30 * 60_000;
export type SyrveOperationContext = { deadline: number; signal: AbortSignal; beforeRequest?: () => Promise<void> };
const operations = new AsyncLocalStorage<SyrveOperationContext>();
export const currentSyrveOperation = () => operations.getStore();
export function withSyrveOperation<T>(context: SyrveOperationContext, action: () => Promise<T>): Promise<T> {
  return operations.run(context, action);
}
export function syrveObservationDeadline(deadline?: number): number {
  const operation = currentSyrveOperation();
  return Math.min(operation?.deadline ?? Date.now() + 45_000, deadline ?? Infinity);
}

export async function withSyrveLease<T>(renew: () => Promise<unknown>, guard: () => Promise<unknown>, action: () => Promise<T>): Promise<T> {
  const operation = currentSyrveOperation();
  if (!operation) return action();
  const abort = new AbortController();
  const heartbeat = setInterval(() => { void renew().catch(() => abort.abort()); }, 15_000);
  try {
    return await withSyrveOperation({ ...operation, signal: AbortSignal.any([operation.signal, abort.signal]),
      beforeRequest: async () => { await operation.beforeRequest?.(); await guard(); } }, action);
  } finally { clearInterval(heartbeat); }
}
