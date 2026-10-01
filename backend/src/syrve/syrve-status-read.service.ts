import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SyrveSettingsStore } from './syrve-settings.store';
import { disabledSyrveStatus, SyrveStatusReadStore, SyrveStatusSnapshot } from './syrve-status-read.store';

@Injectable()
export class SyrveStatusReadService {
  private readonly store: SyrveStatusReadStore;
  constructor(source: DataSource) { this.store = new SyrveStatusReadStore(source, new SyrveSettingsStore(source)); }

  private enabled(): boolean { return false; }

  async snapshot(tableIds: string[]): Promise<SyrveStatusSnapshot> {
    // Activation is a separate reviewed stage. No environment flag, DTO or saved
    // credentials can enable this gate or cause a feature query in this PR.
    if (!this.enabled()) return disabledSyrveStatus();
    return this.store.read(tableIds);
  }
}
