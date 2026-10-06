import { ConflictException, HttpException, Injectable, NotFoundException, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/types/auth-user.type';
import { loadingActor } from './syrve-table-loading';
import { SYRVE_OPERATION_BUDGET_MS, withSyrveOperation } from './syrve-operation-context';

const INTERRUPTED = { statusCode: 409, message: 'Перевірку Syrve перервано. Повторіть дію з актуальними налаштуваннями.' };
@Injectable()
export class SyrveOperationsService implements OnApplicationShutdown {
  private readonly runner = randomUUID();
  private readonly active = new Map<string, { abort: AbortController; pending: Promise<void> }>();
  private stopped = false;
  constructor(private readonly source: DataSource) {}
  private table() {
    const options = this.source.options;
    const schema = options.type === 'postgres' ? options.schema || 'public' : 'public';
    return '"' + schema.replace(/"/g, '""') + '"."syrve_operations"';
  }
  private owner(actor?: AuthUser) {
    try { return loadingActor(actor); }
    catch { throw new ConflictException('Сесію Директора не підтверджено. Увійдіть повторно.'); }
  }
  private async expire(owner: string) {
    await this.source.query('UPDATE ' + this.table() + " SET status='failed',completed_at=clock_timestamp(),error=$2::jsonb"
      + " WHERE owner_hash=$1 AND status='running' AND (live_until<=clock_timestamp() OR expires_at<=clock_timestamp())", [owner, JSON.stringify(INTERRUPTED)]);
  }
  async start(actor: AuthUser | undefined, kind: string, action: () => Promise<unknown>, authorize: () => Promise<unknown>) {
    if (this.stopped) throw new ServiceUnavailableException('Перевірку Syrve перервано. Повторіть дію пізніше.');
    const owner = this.owner(actor), id = randomUUID();
    if (!/^[a-z-]{1,40}$/.test(kind)) throw new ConflictException('Невідома перевірка Syrve.');
    try {
      await this.expire(owner);
      // Keep only a bounded retention window for private results/proofs.
      await this.source.query('DELETE FROM ' + this.table() + " WHERE owner_hash=$1 AND status<>'running' AND completed_at<clock_timestamp()-interval '1 day'", [owner]);
      await this.source.query('INSERT INTO ' + this.table() + ' (id,owner_hash,runner_id,kind,expires_at,live_until)'
        + " VALUES ($1,$2,$3,$4,clock_timestamp()+$5*interval '1 millisecond',clock_timestamp()+interval '60 seconds')",
      [id, owner, this.runner, kind, SYRVE_OPERATION_BUDGET_MS]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Перевірка Syrve вже триває. Дочекайтеся її завершення.');
      throw new ServiceUnavailableException('Поетапну перевірку Syrve ще не підготовлено на сервері.');
    }
    const abort = new AbortController(), deadline = Date.now() + SYRVE_OPERATION_BUDGET_MS;
    const heartbeat = setInterval(() => { void this.renew(id, owner).catch(() => abort.abort()); }, 15_000);
    const timeout = setTimeout(() => abort.abort(), SYRVE_OPERATION_BUDGET_MS);
    const guard = async () => {
      if (abort.signal.aborted) throw new ConflictException(INTERRUPTED);
      await authorize();
      const [row] = await this.source.query('SELECT id FROM ' + this.table()
        + " WHERE id=$1 AND owner_hash=$2 AND runner_id=$3 AND status='running' AND live_until>clock_timestamp() AND expires_at>clock_timestamp()", [id, owner, this.runner]);
      if (!row || abort.signal.aborted) throw new ConflictException(INTERRUPTED);
    };
    const pending = (async () => {
      let result: unknown = null, error: object | null = null;
      try {
        await guard();
        result = await withSyrveOperation({ deadline, signal: abort.signal, beforeRequest: guard }, action);
        await guard();
      } catch (failure) {
        // Provider responses are already sanitized by SyrveClient. Never
        // serialize unexpected exceptions, input, stack traces or fetch URLs.
        const response = failure instanceof HttpException ? failure.getResponse() : null;
        error = response && typeof response === 'object' ? response
          : { statusCode: failure instanceof HttpException ? failure.getStatus() : 503,
              message: typeof response === 'string' ? response : 'Не вдалося завершити перевірку Syrve. Повторіть дію.' };
        result = null;
      } finally {
        clearInterval(heartbeat); clearTimeout(timeout);
      }
      try {
        await this.source.query('UPDATE ' + this.table() + ' SET status=$4,completed_at=clock_timestamp(),result=$5::jsonb,error=$6::jsonb'
          + " WHERE id=$1 AND owner_hash=$2 AND runner_id=$3 AND status='running' AND live_until>clock_timestamp() AND expires_at>clock_timestamp()",
        [id, owner, this.runner, error ? 'failed' : 'done', JSON.stringify(result), JSON.stringify(error)]);
      } catch { /* The durable live lease expires; no false success is returned. */ }
    })();
    this.active.set(id, { abort, pending });
    void pending.finally(() => this.active.delete(id));
    return { status: 'running' as const, operationId: id, pollAfterMs: 15_000 };
  }
  private async renew(id: string, owner: string) {
    const renewed = await this.source.query('UPDATE ' + this.table() + " SET live_until=LEAST(expires_at,clock_timestamp()+interval '60 seconds')"
      + " WHERE id=$1 AND owner_hash=$2 AND runner_id=$3 AND status='running' AND live_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id", [id, owner, this.runner]);
    const [row] = Array.isArray(renewed[0]) ? renewed[0] : renewed;
    if (!row) throw new ConflictException(INTERRUPTED);
  }
  async read(id: string, actor?: AuthUser) {
    const owner = this.owner(actor);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new NotFoundException('Перевірку Syrve не знайдено.');
    try {
      await this.expire(owner);
      const [row] = await this.source.query('SELECT status,result,error,completed_at FROM ' + this.table() + ' WHERE id=$1 AND owner_hash=$2', [id, owner]);
      if (!row) throw new NotFoundException('Перевірку Syrve не знайдено.');
      return { operationId: id, status: row.status, result: row.result, error: row.error, completedAt: row.completed_at, pollAfterMs: 15_000 };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException('Не вдалося оновити перебіг перевірки Syrve.');
    }
  }
  async onApplicationShutdown() {
    this.stopped = true;
    for (const task of this.active.values()) task.abort.abort();
    await Promise.allSettled([...this.active.values()].map(task => task.pending));
  }
}
