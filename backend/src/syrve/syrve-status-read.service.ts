import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SyrveSettingsStore } from './syrve-settings.store';
import { SyrveStatusReadStore, SyrveStatusSnapshot } from './syrve-status-read.store';

@Injectable()
export class SyrveStatusReadService {
  private readonly store: SyrveStatusReadStore;
  constructor(source: DataSource) { this.store = new SyrveStatusReadStore(source, new SyrveSettingsStore(source)); }

  async snapshot(tableIds: string[]): Promise<SyrveStatusSnapshot> {
    // Consent and configuration share the same read-only frame as the physical
    // status and ledger. This path never talks to Syrve or writes state.
    return this.store.read(tableIds);
  }
}
