import { api } from './client';

type Progress<T> = { operationId: string; status: 'running' | 'done' | 'failed'; result?: T;
  error?: { message?: string | string[] }; pollAfterMs: number };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
// Poll MOLO only. Waiting for progress never issues another Syrve request or
// restarts a submitted action, including after a temporary progress-read error.
export async function syrveOperation<T>(path: string, body: unknown): Promise<T> {
  const accepted = await api.post<T | Progress<T>>(path, body);
  if (!accepted || typeof accepted !== 'object' || !('operationId' in accepted)) return accepted as T;
  const initial = accepted as Progress<T>;
  if (!UUID.test(initial.operationId) || initial.status !== 'running') throw new Error('Недійсний перебіг перевірки Syrve.');
  const until = performance.now() + 31 * 60_000;
  let failures = 0;
  while (performance.now() < until) {
    await new Promise<void>(resolve => setTimeout(resolve, 15_000));
    let progress: Progress<T>;
    try { progress = await api.get<Progress<T>>('/syrve-integration/operations/' + initial.operationId); failures = 0; }
    catch (error) { if (++failures >= 4) throw error; continue; }
    if (!progress || progress.operationId !== initial.operationId || !['running', 'done', 'failed'].includes(progress.status)) {
      throw new Error('Недійсний перебіг перевірки Syrve.');
    }
    if (progress.status === 'done') return progress.result as T;
    if (progress.status === 'failed') {
      const message = progress.error?.message;
      throw new Error(Array.isArray(message) ? message.join('\n') : message || 'Не вдалося завершити перевірку Syrve.');
    }
  }
  throw new Error('Перевірка Syrve ще триває. Оновіть стан підключення перед повторною дією.');
}
