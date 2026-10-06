import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { SyrveIntegrationService } from './syrve-integration.service';
import { SyrveSettingsStore } from './syrve-settings.store';
import { SyrveWorkerStore } from './syrve-worker.store';
import { SyrveWorkerRunner } from './syrve-worker.runner';
import { SYRVE_WORKER_INTERVAL_MS, SyrveWorkerResult } from './syrve-worker.model';
import { SYRVE_OPERATION_BUDGET_MS } from './syrve-operation-context';

@Injectable()
export class SyrveWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(SyrveWorkerService.name);
  private readonly runner: SyrveWorkerRunner;
  private stopped = false;
  constructor(source: DataSource, settings: SyrveSettingsStore, integration: SyrveIntegrationService) {
    this.runner = new SyrveWorkerRunner(new SyrveWorkerStore(source, settings),
      (capture, ids, controls) => integration.probeWorkerOrders(capture, ids, controls),
      (captures, leaseId, controls) => integration.probeWorkerBatch(captures, leaseId, controls), SYRVE_OPERATION_BUDGET_MS);
  }
  @Interval('syrve-prepared-worker', SYRVE_WORKER_INTERVAL_MS)
  async tick(): Promise<SyrveWorkerResult> {
    // The runner claims only a current, explicitly consented configuration.
    // Missing activation schema/receipt stays off; credentials and flags cannot enable it.
    if (this.stopped) return { status: 'disabled', processed: 0 };
    const result = await this.runner.run();
    if (result.status === 'failed') this.logger.warn('Фонове спостереження Syrve призупинено: ' + result.code);
    return result;
  }
  async onModuleDestroy() { this.stopped = true; await this.runner.stop(); }
}
