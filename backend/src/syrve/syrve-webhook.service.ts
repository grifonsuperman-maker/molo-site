import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SyrveActivationStore } from './syrve-activation.store';
import { SyrveClient } from './syrve-client';
import { SyrveSettingsStore, settingsVersion } from './syrve-settings.store';
import { SyrveStateStore } from './syrve-state.store';
import { parseSyrveWebhookBatch, SyrveWebhookTopologyError } from './syrve-webhook';

@Injectable()
export class SyrveWebhookService {
  private readonly states: SyrveStateStore;
  private readonly logger = new Logger(SyrveWebhookService.name);
  constructor(source: DataSource, private readonly settings: SyrveSettingsStore,
    private readonly activation: SyrveActivationStore, private readonly client: SyrveClient) {
    this.states = new SyrveStateStore(source, settings);
  }

  async receive(revision: string, body: unknown) {
    let batch: ReturnType<typeof parseSyrveWebhookBatch>;
    try { batch = parseSyrveWebhookBatch(body); }
    catch { throw new BadRequestException('Некоректний формат сповіщення Syrve.'); }
    const snapshot = await this.settings.read(), entity = snapshot.entity;
    if (!snapshot.prepared || !entity || entity.configurationRevision !== revision || entity.status !== 'connected'
      || !entity.organizationId || batch.organizationIds.some(id => id !== entity.organizationId)) {
      throw new ConflictException('Сповіщення не відповідає поточному підключенню Syrve.');
    }
    const version = settingsVersion(snapshot);
    // The same Director consent as polling. Disconnect/disable/rebind revokes
    // processing; receiving a webhook cannot enable auto-status or load POS.
    const active = await this.activation.read(snapshot);
    if (!active.enabled || !active.plan) throw new ConflictException('Автостатуси Syrve вимкнено.');
    if (!batch.orders.length) return { accepted: true, events: 0, statusesApplied: 0 };
    const captures = await this.states.captureBatch(snapshot.links.map(link => link.moloTableId), version);
    const result = await this.settings.transaction(version, async (manager, current) => {
      const consent = await this.activation.read(current, manager);
      if (!consent.enabled || !consent.plan) throw new ConflictException('Автостатуси Syrve вимкнено.');
      const topology = this.client.webhookTopology(entity.organizationId!, revision);
      if (!topology) throw new ServiceUnavailableException('Очікується свіжа перевірка кас Syrve. Сповіщення не застосовано.');
      let applied: { events: number; statusesApplied: number };
      try { applied = await this.states.applyWebhookOrdersInTransaction(manager, current, captures, batch.orders, topology); }
      catch (error) {
        if (error instanceof SyrveWebhookTopologyError) throw new ServiceUnavailableException('Столи або касові групи Syrve не підтверджено. Сповіщення не застосовано.');
        throw error;
      }
      if (!this.client.isCurrentWebhookTopology(topology)) throw new ServiceUnavailableException('Перевірка кас Syrve змінилася або застаріла. Сповіщення не застосовано.');
      return applied;
    });
    // Acknowledge only committed work. No body, token, order or customer details
    // enter logs or responses; polling remains the recovery path after an outage.
    this.logger.log('Сповіщення Syrve: ' + JSON.stringify(result));
    return { accepted: true, ...result };
  }
}
