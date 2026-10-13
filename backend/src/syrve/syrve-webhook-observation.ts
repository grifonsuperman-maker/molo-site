import { HttpException, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import type { SyrveObservedOrder } from './syrve-order-observer';
import type { SyrveTableSyncState, SyrveWebhookTransition } from './syrve-state-reducer';

type Step = 'authorization' | 'payload' | 'configuration' | 'activation' | 'capture' | 'transaction' | 'topology' | 'apply' | 'commit';
type Reason = 'UNAUTHORIZED' | 'AUTHORIZATION_UNAVAILABLE' | 'INVALID_PAYLOAD' | 'CONFIGURATION_CHANGED'
  | 'AUTO_STATUS_DISABLED' | 'LOCAL_STATE_CHANGED' | 'TOPOLOGY_UNAVAILABLE' | 'TOPOLOGY_UNCONFIRMED'
  | 'TOPOLOGY_CHANGED' | 'STATE_STORAGE_UNAVAILABLE' | 'COMMIT_NOT_CONFIRMED' | 'PROCESSING_FAILED';
type Fence = 'physical' | 'ledger' | 'both';
type Binding = { syrveTableId: string; moloTableId: string; lastKnownNumber: number };
type TableRecord = { tableNumber: number; tableRef: string; ledgerChanges: number; statusChanges: number; unchanged: number;
  activeBillsBefore: number | null; activeBillsAfter: number | null; actions: string[]; diagnostics: string[]; fence?: Fence };
const DIAGNOSTICS = new Set(['scope_changed', 'local_revision_changed', 'observation_unknown',
  'visibility_not_verified', 'unknown_orders', 'stale_order', 'conflicting_order_versions']);
const observations = new WeakMap<object, SyrveWebhookObservation>();
const MAX_TABLES = 100;

// Server-created correlation only. Neither headers/body nor callback UUIDs are
// echoed. Observations hold no durable state and never query the POS/database.
export class SyrveWebhookObservation {
  private readonly logger = new Logger('SyrveWebhookObservation');
  private readonly observationId = randomUUID();
  private readonly receivedAt = new Date().toISOString();
  private readonly startedAt = performance.now();
  private currentStep: Step = 'authorization';
  private reason?: Reason;
  private bindings = new Map<string, { tableNumber: number; tableRef: string }>();
  private tables = new Map<string, TableRecord>();
  private events = 0;
  private ignoredEvents = 0;
  private unassociatedOrders = 0;
  private unmappedTables = new Set<string>();

  constructor() { this.write({ stage: 'received' }); }
  step(step: Step) { this.currentStep = step; }
  rejectAs(reason: Reason) { this.reason = reason; }

  bind(links: Binding[], orders: SyrveObservedOrder[], ignoredEvents: number) {
    this.events = orders.length;
    this.ignoredEvents = ignoredEvents;
    for (const link of links.slice(0, MAX_TABLES)) {
      if (Number.isInteger(link.lastKnownNumber) && link.lastKnownNumber >= -2_147_483_648 && link.lastKnownNumber <= 2_147_483_647
        && typeof link.moloTableId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(link.moloTableId)) {
        this.bindings.set(link.syrveTableId, { tableNumber: link.lastKnownNumber,
          tableRef: createHash('sha256').update('molo-webhook-table\0').update(link.moloTableId.toLowerCase()).digest('hex').slice(0,16) });
      }
    }
    for (const order of orders) {
      if (!order.tableIds.length) this.unassociatedOrders++;
      for (const id of order.tableIds) this.table(id);
    }
  }

  private table(id: string): TableRecord | undefined {
    const binding = this.bindings.get(id);
    if (!binding) { this.unmappedTables.add(id); return undefined; }
    if (!this.tables.has(id)) this.tables.set(id, { ...binding,
      ledgerChanges: 0, statusChanges: 0, unchanged: 0, activeBillsBefore: null, activeBillsAfter: null, actions: [], diagnostics: [] });
    return this.tables.get(id);
  }

  related(states: SyrveTableSyncState[], orders: SyrveObservedOrder[]) {
    for (const state of states) if (orders.some(order => order.tableIds.includes(state.scope.syrveTableId)
      || state.orderVersions.some(version => version.id === order.id)
      || (order.state === 'unknown' && !order.tableIds.length))) this.table(state.scope.syrveTableId);
  }

  fence(state: SyrveTableSyncState, physical: boolean, ledger: boolean) {
    const record = this.table(state.scope.syrveTableId);
    if (record) record.fence = physical && ledger ? 'both' : physical ? 'physical' : 'ledger';
    this.rejectAs('LOCAL_STATE_CHANGED');
  }

  transition(before: SyrveTableSyncState, order: SyrveObservedOrder, result: SyrveWebhookTransition) {
    // A global stale diagnostic is relevant only to the order's destination
    // and prior associations, not every table returned by the reducer.
    if (!order.tableIds.includes(before.scope.syrveTableId)
      && !before.orderVersions.some(version => version.id === order.id)
      && !(order.state === 'unknown' && !order.tableIds.length)) return;
    const record = this.table(before.scope.syrveTableId);
    if (!record) return;
    record.activeBillsBefore ??= before.activeSyrveOrderIds.length;
    record.activeBillsAfter = result.state.activeSyrveOrderIds.length;
    if (result.changed) record.ledgerChanges++;
    else record.unchanged++;
    if (result.status === 'occupied' || result.status === 'free') {
      record.statusChanges++;
      if (!record.actions.includes(result.status)) record.actions.push(result.status);
    }
    for (const diagnostic of result.diagnostics) if (DIAGNOSTICS.has(diagnostic) && !record.diagnostics.includes(diagnostic)) {
      record.diagnostics.push(diagnostic);
    }
  }

  accepted(statusesApplied: number) {
    this.write({ stage: 'accepted', httpStatus: 200,
      reason: this.events === 0 ? 'IGNORED_EVENTS' : statusesApplied ? 'STATUS_APPLIED' : 'NO_STATUS_CHANGE',
      statusesApplied, commitConfirmed: true, ...this.summary(true) });
  }

  rejected(error: unknown) {
    const httpStatus = error instanceof HttpException ? error.getStatus() : 500;
    const reason = this.reason || (httpStatus === 400 ? 'INVALID_PAYLOAD' : httpStatus === 409 ? 'CONFIGURATION_CHANGED'
      : httpStatus === 503 ? 'STATE_STORAGE_UNAVAILABLE' : this.currentStep === 'commit' ? 'COMMIT_NOT_CONFIRMED' : 'PROCESSING_FAILED');
    this.write({ stage: 'rejected', httpStatus, reason, statusesApplied: 0, commitConfirmed: false, ...this.summary(false) });
  }

  private summary(committed: boolean) {
    return { events: this.events, ignoredEvents: this.ignoredEvents, unassociatedOrders: this.unassociatedOrders,
      unmappedTables: this.unmappedTables.size,
      tables: [...this.tables.values()].sort((a,b) => a.tableNumber - b.tableNumber || a.tableRef.localeCompare(b.tableRef)).map(record => ({ ...record,
        // Reducer decisions are staged until COMMIT. A rolled-back batch must
        // never be reported as a physical/ledger write, even after SQL ran.
        ledgerChanges: committed ? record.ledgerChanges : 0,
        statusChanges: committed ? record.statusChanges : 0, activeBillsAfter: committed ? record.activeBillsAfter : null,
        actions: committed ? record.actions : [] })) };
  }

  private write(fields: Record<string, unknown>) {
    try {
      const elapsed = performance.now() - this.startedAt;
      const message = 'Діагностика сповіщень Syrve: ' + JSON.stringify({ observationId: this.observationId, receivedAt: this.receivedAt, ...fields,
        recordedAt: new Date().toISOString(), handlingMs: Math.max(0, Math.round(elapsed)), step: this.currentStep });
      if (fields.stage === 'rejected') this.logger.warn(message);
      else this.logger.log(message);
    } catch { /* Best-effort diagnostics cannot change callback acknowledgement or state. */ }
  }
}

// WeakMap state cannot be supplied by a client property/header. The guard and
// controller share one observation, including authorization failures.
export function syrveWebhookObservation(request: object): SyrveWebhookObservation {
  let observation = observations.get(request);
  if (!observation) { observation = new SyrveWebhookObservation(); observations.set(request, observation); }
  return observation;
}
