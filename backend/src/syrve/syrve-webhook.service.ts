import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SyrveActivationStore } from './syrve-activation.store';
import { SyrveClient } from './syrve-client';
import { SyrveSettingsStore, settingsVersion } from './syrve-settings.store';
import { SyrveStateStore } from './syrve-state.store';
import { parseSyrveWebhookBatch, SyrveWebhookTopologyError } from './syrve-webhook';
import { SyrveWebhookObservation } from './syrve-webhook-observation';

@Injectable()
export class SyrveWebhookService {
  private readonly states: SyrveStateStore;
  private readonly logger = new Logger(SyrveWebhookService.name);
  constructor(source: DataSource, private readonly settings: SyrveSettingsStore,
    private readonly activation: SyrveActivationStore, private readonly client: SyrveClient) {
    this.states = new SyrveStateStore(source, settings);
  }

  async receive(revision: string, body: unknown, observation = new SyrveWebhookObservation()) {
    let result: { events: number; statusesApplied: number };
    try {
      observation.step('payload');
      let batch: ReturnType<typeof parseSyrveWebhookBatch>;
      try { batch = parseSyrveWebhookBatch(body); }
      catch { throw new BadRequestException('Некоректний формат сповіщення Syrve.'); }
      observation.step('configuration');
      const snapshot = await this.settings.read(), entity = snapshot.entity;
      if (!snapshot.prepared || !entity || entity.configurationRevision !== revision || entity.status !== 'connected'
        || !entity.organizationId || batch.organizationIds.some(id => id !== entity.organizationId)) {
        observation.rejectAs('CONFIGURATION_CHANGED');
        throw new ConflictException('Сповіщення не відповідає поточному підключенню Syrve.');
      }
      observation.bind(snapshot.links, batch.orders, batch.ignored);
      const version = settingsVersion(snapshot);
      // The same Director consent as polling. Disconnect/disable/rebind revokes
      // processing; receiving a webhook cannot enable auto-status or load POS.
      observation.step('activation');
      const active = await this.activation.read(snapshot);
      if (!active.enabled || !active.plan) {
        observation.rejectAs('AUTO_STATUS_DISABLED'); throw new ConflictException('Автостатуси Syrve вимкнено.');
      }
      if (!batch.orders.length) {
        observation.accepted(0); return { accepted: true, events: 0, statusesApplied: 0 };
      }
      observation.step('capture');
      const captures = await this.states.captureBatch(snapshot.links.map(link => link.moloTableId), version);
      observation.related(captures.map(capture => capture.state), batch.orders);
      observation.step('transaction');
      result = await this.settings.transaction(version, async (manager, current) => {
        const consent = await this.activation.read(current, manager);
        if (!consent.enabled || !consent.plan) {
          observation.rejectAs('AUTO_STATUS_DISABLED'); throw new ConflictException('Автостатуси Syrve вимкнено.');
        }
        observation.step('topology');
        const topology = this.client.webhookTopology(entity.organizationId!, revision);
        if (!topology) {
          observation.rejectAs('TOPOLOGY_UNAVAILABLE');
          throw new ServiceUnavailableException('Очікується свіжа перевірка кас Syrve. Сповіщення не застосовано.');
        }
        observation.step('apply');
        let applied: { events: number; statusesApplied: number };
        try { applied = await this.states.applyWebhookOrdersInTransaction(manager, current, captures, batch.orders, topology, observation); }
        catch (error) {
          if (error instanceof SyrveWebhookTopologyError) {
            observation.rejectAs('TOPOLOGY_UNCONFIRMED');
            throw new ServiceUnavailableException('Столи або касові групи Syrve не підтверджено. Сповіщення не застосовано.');
          }
          throw error;
        }
        if (!this.client.isCurrentWebhookTopology(topology)) {
          observation.rejectAs('TOPOLOGY_CHANGED');
          throw new ServiceUnavailableException('Перевірка кас Syrve змінилася або застаріла. Сповіщення не застосовано.');
        }
        observation.step('commit');
        return applied;
      });
    } catch (error) {
      observation.rejected(error); throw error;
    }
    // Acknowledge only committed work. No body, token, order or customer details
    // enter logs or responses; polling remains the recovery path after an outage.
    observation.accepted(result.statusesApplied);
    try { this.logger.log('Сповіщення Syrve: ' + JSON.stringify(result)); }
    catch { /* A failed log sink must not turn committed work into a retry. */ }
    return { accepted: true, ...result };
  }
}
