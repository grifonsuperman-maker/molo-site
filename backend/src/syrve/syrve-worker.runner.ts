import { SyrveClientException } from './syrve-client';
import type { SyrveBatchProbeControls, SyrveLoadedProbeControls } from './syrve-client';
import type { SyrveOrderProbe } from './syrve-order-observer';
import { SyrveStateValidationError } from './syrve-state-reducer';
import type { SyrveOrderObservationBatch } from './syrve-state-reducer';
import type { SyrveStateCapture } from './syrve-state.store';
import { syrveCaptureContext } from './syrve-state.store';
import { SyrveWorkerStore } from './syrve-worker.store';
import { SYRVE_WORKER_BUDGET_MS, SyrveWorkerError, SyrveWorkerLease, SyrveWorkerResult, workerError } from './syrve-worker.model';

export type SyrveWorkerProbe = (capture: SyrveStateCapture, orderIds: string[], controls: SyrveLoadedProbeControls) => Promise<SyrveOrderProbe>;
export type SyrveWorkerBatchProbe = (captures: SyrveStateCapture[], leaseId: string,
  controls: SyrveBatchProbeControls) => Promise<SyrveOrderObservationBatch[][]>;

// Internal engine, neither provider nor controller/export. Tests inject mocks;
// the scheduler owns it only for a saved, explicitly consented configuration.
export class SyrveWorkerRunner {
  private active: Promise<SyrveWorkerResult> | null = null;
  private stopped = false;
  private abort: AbortController | null = null;
  constructor(private readonly store: SyrveWorkerStore, private readonly probe: SyrveWorkerProbe,
    private readonly batchProbe?: SyrveWorkerBatchProbe) {}

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
    if ((error as any)?.getResponse?.()?.code === 'SYRVE_LOCAL_STATE_CHANGED') return 'SYRVE_LOCAL_STATE_CHANGED';
    if ((error as any)?.getStatus?.() === 409) return 'SYRVE_CONFIGURATION_CHANGED';
    return workerError((error as any)?.getResponse?.()?.code);
  }

  private async cycle(): Promise<SyrveWorkerResult> {
    let lease: SyrveWorkerLease | undefined, linkId: string | undefined, processed = 0, unresolvedCommands = 0;
    const controller = new AbortController(); this.abort = controller;
    const deadline = Date.now() + SYRVE_WORKER_BUDGET_MS;
    const requestBudget = { remaining: 800 }; // Shared bounded cycle; each read/load is additionally capped at 25.
    const timeout = setTimeout(() => controller.abort(), SYRVE_WORKER_BUDGET_MS);
    try {
      const claimed = await this.store.claim();
      if (claimed.status !== 'claimed') return { status: claimed.status, processed };
      lease = claimed.lease;
      const loaded = new Map<string, { captured: SyrveStateCapture; batches: SyrveOrderObservationBatch[] }>();
      if (this.batchProbe) {
        const captures = await this.store.captureBatch(lease);
        if (captures.length !== lease.links.length) throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
        for (const [index, link] of lease.links.entries()) {
          linkId = link.id;
          if (this.stopped) return { status: 'stopped', processed };
          const captured = captures[index], expected = captured.state.scope;
          if (captured.linkId !== link.id || expected.integrationId !== lease.version.id
            || expected.configurationRevision !== lease.version.revision || expected.organizationId !== link.organizationId
            || expected.syrveTableId !== link.syrveTableId) throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
        }
        const loadingPlan = await this.store.guardBatch(lease, captures);
        const result = await this.batchProbe(captures, lease.id, { deadline, signal: controller.signal, requestBudget, loadingPlan,
          commandStarted: () => { unresolvedCommands++; }, commandFinished: () => { unresolvedCommands--; },
          beforeCommand: async () => { await this.store.guardBatch(lease!, captures); } });
        if (!Array.isArray(result) || result.length !== captures.length) throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
        for (const [index, captured] of captures.entries()) {
          const batches = result[index];
          if (!Array.isArray(batches) || batches.length !== captured.orderIds.length
            || batches.some((batch, page) => JSON.stringify(batch.orderIds) !== JSON.stringify(captured.orderIds[page]))) {
            throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
          }
          const failed = batches.flatMap(batch => Object.values(batch.probe.checks)).find(check => check.status === 'error');
          if (failed) throw new SyrveClientException(failed.code as ConstructorParameters<typeof SyrveClientException>[0]);
          loaded.set(captured.linkId, { captured, batches });
        }
      }
      for (const link of lease.links) {
        linkId = link.id;
        if (this.stopped) return { status: 'stopped', processed };
        if (controller.signal.aborted || Date.now() >= deadline) {
          if (processed) return { status: 'observed', processed };
          throw new SyrveClientException('SYRVE_TIMEOUT');
        }
        const captured = loaded.get(link.id)?.captured || await this.store.capture(link.moloTableId);
        if (captured.linkId !== link.id || captured.state.scope.integrationId !== lease.version.id
          || captured.state.scope.configurationRevision !== lease.version.revision
          || captured.state.scope.organizationId !== link.organizationId || captured.state.scope.syrveTableId !== link.syrveTableId) {
          return { status: 'stale', processed, code: 'SYRVE_CONFIGURATION_CHANGED' };
        }
        const batches: SyrveOrderObservationBatch[] = loaded.get(link.id)?.batches || [];
        const loadingPlan = loaded.has(link.id) ? null : await this.store.guard(lease, captured);
        for (const orderIds of loaded.has(link.id) ? [] : captured.orderIds) {
          if (this.stopped) return { status: 'stopped', processed };
          const probe = await this.probe(captured, orderIds, { deadline, signal: controller.signal, requestBudget, loadingPlan: loadingPlan!,
            visibilityContext: syrveCaptureContext(lease.id, captured),
            commandStarted: () => { unresolvedCommands++; },
            commandFinished: () => { unresolvedCommands--; },
            beforeCommand: async () => { await this.store.guard(lease!, captured); } });
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
      return { status: this.stopped ? 'stopped' : ['SYRVE_CONFIGURATION_CHANGED','SYRVE_LOCAL_STATE_CHANGED'].includes(code) ? 'stale' : 'failed', processed, code };
    } finally {
      clearTimeout(timeout); this.abort = null;
      // A timed-out/pending/expired command may still be running in the POS.
      // Retain exclusion until the bounded lease expires, including revocation.
      if (lease && unresolvedCommands === 0) { try { await this.store.release(lease); } catch { /* Bounded DB lease expires after connection loss. */ } }
    }
  }
}
