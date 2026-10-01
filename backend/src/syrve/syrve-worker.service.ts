import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { SyrveIntegrationService } from './syrve-integration.service';
import { SyrveSettingsStore } from './syrve-settings.store';
import { SyrveWorkerStore } from './syrve-worker.store';
import { SyrveWorkerRunner } from './syrve-worker.runner';
import { SYRVE_WORKER_INTERVAL_MS, SyrveWorkerResult } from './syrve-worker.model';

@Injectable()
export class SyrveWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(SyrveWorkerService.name);
  private readonly runner: SyrveWorkerRunner;
  private stopped = false;
  constructor(source: DataSource, settings: SyrveSettingsStore, integration: SyrveIntegrationService) {
    this.runner = new SyrveWorkerRunner(new SyrveWorkerStore(source, settings),
      (capture, ids, controls) => integration.probeWorkerOrders(capture, ids, controls));
  }
  private enabled(): boolean { return false; }

  @Interval('syrve-prepared-worker', SYRVE_WORKER_INTERVAL_MS)
  async tick(): Promise<SyrveWorkerResult> {
    // Credentials, environment flags and HTTP requests cannot activate this stage.
    // Return before acquiring a lease, reading settings or contacting Syrve.
    if (!this.enabled() || this.stopped) return { status: 'disabled', processed: 0 };
    const result = await this.runner.run();
    if (result.status === 'failed') this.logger.warn('Фонове спостереження Syrve призупинено: ' + result.code);
    return result;
  }
  async onModuleDestroy() { this.stopped = true; await this.runner.stop(); }
}
