import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { DataSource } from 'typeorm';

// A little slower than 30 seconds: the permit may take up to one second to
// reach fetch. Three actual dispatches still cannot fit in any 60-second window.
export const SYRVE_REQUEST_GAP_MS = 31_000;
export const SYRVE_PERMIT_LIFETIME_MS = 1_000;
const MAX_WAIT_MS = 120_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

export type SyrveRequestPermit = { expiresAt: number };
export class SyrveRequestLimitError extends Error {
  constructor(readonly reason: 'limited' | 'unavailable' | 'cancelled', readonly retryAfterMs = 60_000) {
    super('Syrve request admission failed');
  }
}

export class SyrveRequestGuardError extends Error {
  constructor(readonly guardError: unknown) { super('Syrve request validation failed'); }
}

export function syrveRequestKey(apiLogin: string): string {
  // Do not use settings revision, token, organization or process identity:
  // all operations for one login must retain the same quota after reconfiguration.
  return createHash('sha256').update('molo-syrve-request-quota\0').update(apiLogin.trim()).digest('hex');
}

export function isFreshSyrvePermit(permit: SyrveRequestPermit): boolean {
  return Number.isFinite(permit?.expiresAt) && performance.now() < permit.expiresAt;
}

export function syrveRetryAfterMs(header: string | null, responseDate: string | null, now = Date.now()): number {
  let delay = 60_000;
  if (header && /^\d{1,9}$/.test(header.trim())) delay = Number(header.trim()) * 1_000;
  else if (header) {
    const end = Date.parse(header), serverNow = responseDate ? Date.parse(responseDate) : NaN;
    if (Number.isFinite(end)) delay = end - (Number.isFinite(serverNow) ? serverNow : now);
  }
  return Math.min(MAX_COOLDOWN_MS, Math.max(60_000, Number.isFinite(delay) ? delay : 60_000));
}

@Injectable()
export class SyrveRequestLimiter {
  constructor(private readonly dataSource: DataSource) {}

  private table(): string {
    const options = this.dataSource.options;
    const schema = options?.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."syrve_request_limits"';
  }

  private async claim(key: string): Promise<number> {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new SyrveRequestLimitError('unavailable');
    try {
      return await this.dataSource.transaction(async manager => {
        await manager.query("SET LOCAL lock_timeout = '750ms'");
        await manager.query("SET LOCAL statement_timeout = '2s'");
        const table = this.table();
        const granted = await manager.query('INSERT INTO ' + table + ' AS quota (key_hash,next_request_at)'
          + " VALUES ($1,clock_timestamp()+$2*interval '1 millisecond')"
          + " ON CONFLICT (key_hash) DO UPDATE SET next_request_at=clock_timestamp()+$2*interval '1 millisecond'"
          + ' WHERE quota.next_request_at<=clock_timestamp() RETURNING key_hash', [key, SYRVE_REQUEST_GAP_MS]);
        if (granted.length === 1) return 0;
        const [row] = await manager.query('SELECT GREATEST(1,ceil(EXTRACT(EPOCH FROM'
          + ' (next_request_at-clock_timestamp()))*1000)) AS wait_ms FROM ' + table + ' WHERE key_hash=$1', [key]);
        const delay = Number(row?.wait_ms);
        if (!Number.isSafeInteger(delay) || delay <= 0) throw new Error('Invalid quota state');
        return delay;
      });
    } catch {
      // Missing migration, lock timeout, permission failure and lost connections
      // never fall back to an in-memory quota or an unguarded HTTP request.
      throw new SyrveRequestLimitError('unavailable');
    }
  }

  private wait(delay: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new SyrveRequestLimitError('cancelled')); return; }
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new SyrveRequestLimitError('cancelled')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async acquire(key: string, controls: { deadline?: number; signal?: AbortSignal; beforeClaim?: () => Promise<void> } = {}): Promise<SyrveRequestPermit> {
    if (controls.deadline !== undefined && !Number.isFinite(controls.deadline)) throw new SyrveRequestLimitError('cancelled');
    const remaining = controls.deadline === undefined ? MAX_WAIT_MS : Math.min(MAX_WAIT_MS, controls.deadline - Date.now());
    const until = performance.now() + Math.max(0, remaining);
    // Waiting never holds a PostgreSQL connection or transaction. Independent
    // instances arbitrate through the same durable row on each attempt.
    for (let attempt = 0; attempt < 8; attempt++) {
      if (controls.signal?.aborted) throw new SyrveRequestLimitError('cancelled');
      if (performance.now() >= until) throw new SyrveRequestLimitError('limited');
      // Revalidate after each quota wait, before starting the one-second permit.
      // Slow authorization/lease SQL must not consume its dispatch lifetime.
      // The callback holds no quota transaction or PostgreSQL connection.
      try { await controls.beforeClaim?.(); }
      catch (error) { throw new SyrveRequestGuardError(error); }
      if (controls.signal?.aborted) throw new SyrveRequestLimitError('cancelled');
      if (performance.now() >= until) throw new SyrveRequestLimitError('limited');
      const started = performance.now(), delay = await this.claim(key);
      if (controls.signal?.aborted) throw new SyrveRequestLimitError('cancelled');
      if (delay === 0) {
        const permit = { expiresAt: Math.min(until, started + SYRVE_PERMIT_LIFETIME_MS) };
        if (!isFreshSyrvePermit(permit)) throw new SyrveRequestLimitError('limited', SYRVE_REQUEST_GAP_MS);
        return permit;
      }
      if (delay >= until - performance.now()) throw new SyrveRequestLimitError('limited', delay);
      await this.wait(delay, controls.signal);
    }
    throw new SyrveRequestLimitError('limited');
  }

  async cooldown(key: string, delay: number): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(key) || !Number.isSafeInteger(delay) || delay < 60_000 || delay > MAX_COOLDOWN_MS)
      throw new SyrveRequestLimitError('unavailable');
    try {
      await this.dataSource.transaction(async manager => {
        await manager.query("SET LOCAL lock_timeout = '750ms'");
        await manager.query("SET LOCAL statement_timeout = '2s'");
        await manager.query('INSERT INTO ' + this.table() + ' AS quota (key_hash,next_request_at)'
          + " VALUES ($1,clock_timestamp()+$2*interval '1 millisecond')"
          + ' ON CONFLICT (key_hash) DO UPDATE SET next_request_at=GREATEST(quota.next_request_at,EXCLUDED.next_request_at)', [key, delay]);
      });
    } catch { throw new SyrveRequestLimitError('unavailable'); }
  }
}
