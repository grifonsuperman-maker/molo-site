import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { DataSource } from 'typeorm';

// A little slower than 30 seconds: the permit may take up to one second to
// reach fetch. Three actual dispatches still cannot fit in any 60-second window.
export const SYRVE_REQUEST_GAP_MS = 31_000;
// Support confirmed 100 directory requests per ten minutes. Spacing permits
// by 6.1s also caps sends at ten per rolling minute despite their 1s lifetime.
// Unconfirmed methods keep their existing shared, conservative allowance.
export const SYRVE_DIRECTORY_REQUEST_GAP_MS = 6_100;
export const SYRVE_PERMIT_LIFETIME_MS = 1_000;
const MAX_WAIT_MS = 120_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

export type SyrveRequestPermit = { expiresAt: number };
export type SyrveRequestGroup = 'directories' | 'conservative';
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

export function syrveRequestGroup(path: string): SyrveRequestGroup {
  switch (path) {
    case '/api/1/organizations':
    case '/api/1/terminal_groups':
    case '/api/1/reserve/available_restaurant_sections': return 'directories';
    // In particular, by_table/by_id return order details, not directories.
    // Do not create separate quotas for each order endpoint or cash group.
    default: return 'conservative';
  }
}

export function syrveDirectoryRequestKey(key: string): string {
  return createHash('sha256').update('molo-syrve-directory-quota\0').update(key).digest('hex');
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

  private async claim(key: string, group: SyrveRequestGroup): Promise<number> {
    if (!/^[0-9a-f]{64}$/.test(key) || !['directories', 'conservative'].includes(group)) throw new SyrveRequestLimitError('unavailable');
    try {
      return await this.dataSource.transaction(async manager => {
        await manager.query("SET LOCAL lock_timeout = '750ms'");
        await manager.query("SET LOCAL statement_timeout = '2s'");
        const table = this.table();
        const directory = group === 'directories';
        const quotaKey = directory ? syrveDirectoryRequestKey(key) : key;
        const gap = directory ? SYRVE_DIRECTORY_REQUEST_GAP_MS : SYRVE_REQUEST_GAP_MS;
        if (directory) {
          // Retain the original login row as a barrier. Existing permits and
          // cooldowns, including those written by the previous deployment,
          // must expire before a directory request can dispatch. Lock that row
          // before checking so concurrent cooldowns cannot race this admission.
          // A successful listing extends this shared barrier by only 6.1s,
          // keeping mixed old/new deployments below ten total sends/minute.
          await manager.query('INSERT INTO ' + table + ' (key_hash,next_request_at) VALUES ($1,clock_timestamp())'
            + ' ON CONFLICT (key_hash) DO NOTHING', [key]);
          const [barrier] = await manager.query('SELECT GREATEST(0,ceil(EXTRACT(EPOCH FROM'
            + ' (next_request_at-clock_timestamp()))*1000)) AS wait_ms FROM ' + table + ' WHERE key_hash=$1 FOR UPDATE', [key]);
          const delay = Number(barrier?.wait_ms);
          if (!Number.isSafeInteger(delay) || delay < 0) throw new Error('Invalid quota barrier');
          if (delay > 0) return delay;
        }
        const granted = await manager.query('INSERT INTO ' + table + ' AS quota (key_hash,next_request_at)'
          + " VALUES ($1,clock_timestamp()+$2*interval '1 millisecond')"
          + " ON CONFLICT (key_hash) DO UPDATE SET next_request_at=clock_timestamp()+$2*interval '1 millisecond'"
          + ' WHERE quota.next_request_at<=clock_timestamp() RETURNING key_hash', [quotaKey, gap]);
        if (granted.length === 1) {
          if (directory) await manager.query('UPDATE ' + table
            + " SET next_request_at=clock_timestamp()+$2*interval '1 millisecond' WHERE key_hash=$1", [key, gap]);
          return 0;
        }
        const [row] = await manager.query('SELECT GREATEST(1,ceil(EXTRACT(EPOCH FROM'
          + ' (next_request_at-clock_timestamp()))*1000)) AS wait_ms FROM ' + table + ' WHERE key_hash=$1', [quotaKey]);
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

  async acquire(key: string, controls: { deadline?: number; signal?: AbortSignal; beforeClaim?: () => Promise<void>; group?: SyrveRequestGroup } = {}): Promise<SyrveRequestPermit> {
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
      const started = performance.now(), delay = await this.claim(key, controls.group ?? 'conservative');
      if (controls.signal?.aborted) throw new SyrveRequestLimitError('cancelled');
      if (delay === 0) {
        const permit = { expiresAt: Math.min(until, started + SYRVE_PERMIT_LIFETIME_MS) };
        if (!isFreshSyrvePermit(permit)) throw new SyrveRequestLimitError('limited', controls.group === 'directories' ? SYRVE_DIRECTORY_REQUEST_GAP_MS : SYRVE_REQUEST_GAP_MS);
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
