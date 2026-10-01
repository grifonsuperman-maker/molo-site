import { SyrveClientException } from './syrve-client';
import type { SyrveProbeControls } from './syrve-client';
import type { SyrveOrderProbe } from './syrve-order-observer';
import { SyrveStateValidationError } from './syrve-state-reducer';
import type { SyrveOrderObservationBatch } from './syrve-state-reducer';
import type { SyrveStateCapture } from './syrve-state.store';
import { SyrveWorkerStore } from './syrve-worker.store';
import { SYRVE_WORKER_BUDGET_MS, SyrveWorkerError, SyrveWorkerLease, SyrveWorkerResult, workerError } from './syrve-worker.model';

export type SyrveWorkerProbe = (capture: SyrveStateCapture, orderIds: string[], controls: SyrveProbeControls) => Promise<SyrveOrderProbe>;

// Internal engine, neither provider nor controller/export. Tests inject mocks;
// only the hard-disabled service owns the production runner.
export class SyrveWorkerRunner {
  private active: Promise<SyrveWorkerResult> | null = null;
  private stopped = false;
  private abort: AbortController | null = null;
  constructor(private readonly store: SyrveWorkerStore, private readonly probe: SyrveWorkerProbe) {}

  run(): Promise<SyrveWorkerResult> {
    if (this.stopped) return Promise.resolve({ status: 'stopped', processed: 0 });
    if (this.active) return Promise.resolve({ status: 'busy', processed: 0 });
    const pending = this.cycle();
    this.active = pending;
    void pending.finally(() => { if (this.active === pending) this.active = null; });
    return pending;
  }

  async stop() { this.stopped = true; this.abort?.abort(); await this.active; }

  private code(error: unknown): SyrveWorkerError {
    if (error instanceof SyrveStateValidationError) return 'SYRVE_STATE_INVALID';
    if ((error as any)?.getStatus?.() === 409) return 'SYRVE_CONFIGURATION_CHANGED';
    return workerError((error as any)?.getResponse?.()?.code);
  }

  private async cycle(): Promise<SyrveWorkerResult> {
    let lease: SyrveWorkerLease | undefined, linkId: string | undefined, processed = 0;
    const controller = new AbortController(); this.abort = controller;
    const deadline = Date.now() + SYRVE_WORKER_BUDGET_MS;
    const timeout = setTimeout(() => controller.abort(), SYRVE_WORKER_BUDGET_MS);
    try {
      const claimed = await this.store.claim();
      if (claimed.status !== 'claimed') return { status: claimed.status, processed };
      lease = claimed.lease;
      for (const link of lease.links) {
        linkId = link.id;
        if (this.stopped) return { status: 'stopped', processed };
        if (controller.signal.aborted || Date.now() >= deadline) {
          if (processed) return { status: 'observed', processed };
          throw new SyrveClientException('SYRVE_TIMEOUT');
        }
        const captured = await this.store.capture(link.moloTableId);
        if (captured.linkId !== link.id || captured.state.scope.integrationId !== lease.version.id
          || captured.state.scope.configurationRevision !== lease.version.revision
          || captured.state.scope.organizationId !== link.organizationId || captured.state.scope.syrveTableId !== link.syrveTableId) {
          return { status: 'stale', processed, code: 'SYRVE_CONFIGURATION_CHANGED' };
        }
        const batches: SyrveOrderObservationBatch[] = [];
        for (const orderIds of captured.orderIds) {
          if (this.stopped) return { status: 'stopped', processed };
          const probe = await this.probe(captured, orderIds, { deadline, signal: controller.signal });
          if (this.stopped) return { status: 'stopped', processed };
          if (controller.signal.aborted || Date.now() >= deadline) {
            await this.store.failure(lease, link.id, 'SYRVE_TIMEOUT');
            return { status: 'failed', processed, code: 'SYRVE_TIMEOUT' };
          }
          const failed = Object.values(probe.checks).find((check) => check.status === 'error');
          if (failed) {
            const code = workerError(failed.code);
            await this.store.failure(lease, link.id, code);
            return { status: 'failed', processed, code };
          }
          batches.push({ orderIds, probe });
        }
        const applied = await this.store.apply(lease, captured, batches);
        if (applied.code) return { status: applied.code === 'SYRVE_LOCAL_STATE_CHANGED' ? 'stale' : 'failed', processed, code: applied.code };
        processed++;
      }
      return { status: 'observed', processed };
    } catch (error) {
      const code = this.code(error);
      if (lease && linkId && !this.stopped) {
        try { await this.store.failure(lease, linkId, code); } catch { /* Changed scope or unavailable database: no stale bookkeeping. */ }
      }
      return { status: this.stopped ? 'stopped' : code === 'SYRVE_CONFIGURATION_CHANGED' ? 'stale' : 'failed', processed, code };
    } finally {
      clearTimeout(timeout); this.abort = null;
      if (lease) { try { await this.store.release(lease); } catch { /* Bounded DB lease expires after connection loss. */ } }
    }
  }
}
