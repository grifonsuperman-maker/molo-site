import { createHmac, timingSafeEqual } from 'crypto';
import { mergeSyrveOrders, parseSyrveOrders, SyrveOrderValidationError, type SyrveObservedOrder } from './syrve-order-observer';
import { syrveCredentialsKey } from './syrve-credentials';

export const SYRVE_WEBHOOK_MAX_EVENTS = 100;
export const SYRVE_WEBHOOK_TOPOLOGY_TTL_MS = 120_000;
export class SyrveWebhookTopologyError extends Error {}
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const isSyrveWebhookRevision = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

// Issued only after a complete, initialized transport read. It contains no
// orders or credentials and is never accepted from a callback/Director DTO.
export type SyrveWebhookTopology = {
  organizationId: string;
  configurationRevision: string;
  expiresAt: number;
  tables: { id: string; terminalGroupId: string; isDeleted: boolean }[];
  liveGroupIds: string[];
  visibleTableIds: string[];
};

// Domain-separated from credential encryption and rotated with the saved
// configuration. The token belongs in Syrve's authToken, never in the URL.
export function syrveWebhookToken(configurationRevision: string): string {
  if (!isSyrveWebhookRevision(configurationRevision)) throw new SyrveOrderValidationError();
  return createHmac('sha256', syrveCredentialsKey()).update('molo-syrve-webhook-v1\0')
    .update(configurationRevision.toLowerCase()).digest('base64url');
}

export function hasSyrveWebhookAuthorization(header: unknown, configurationRevision: unknown): boolean {
  if (!isSyrveWebhookRevision(configurationRevision) || typeof header !== 'string' || header.length > 100) return false;
  // Accept the configured token literally or with the standard Bearer prefix.
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const expected = syrveWebhookToken(configurationRevision);
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export type SyrveWebhookBatch = { organizationIds: string[]; orders: SyrveObservedOrder[]; ignored: number };
export function parseSyrveWebhookBatch(payload: unknown): SyrveWebhookBatch {
  // Syrve sends a batch. A single notification envelope is also unambiguous.
  const events = Array.isArray(payload) ? payload : [payload];
  if (!events.length || events.length > SYRVE_WEBHOOK_MAX_EVENTS) throw new SyrveOrderValidationError();
  const organizations = new Set<string>(), orders: SyrveObservedOrder[] = [];
  let ignored = 0;
  for (const value of events) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyrveOrderValidationError();
    const event = value as Record<string, unknown>;
    if (!isSyrveWebhookRevision(event.organizationId) || typeof event.eventType !== 'string'
      || !event.eventType || event.eventType.length > 80) throw new SyrveOrderValidationError();
    const organizationId = event.organizationId.toLowerCase();
    organizations.add(organizationId);
    // Error, delivery and reserve events are not bill lifecycle evidence.
    if (event.eventType !== 'TableOrderUpdate') { ignored++; continue; }
    if (!isSyrveWebhookRevision(event.correlationId)) throw new SyrveOrderValidationError();
    const info = event.eventInfo as Record<string, unknown>;
    if (!info || !isSyrveWebhookRevision(info.id)) throw new SyrveOrderValidationError();
    // Reuse polling normalization and fingerprints. eventTime is deliberately
    // not a version: the provider's integer timestamp is the durable watermark.
    orders.push(...parseSyrveOrders({ correlationId: event.correlationId, orders: [info] },
      organizationId, { orderIds: [info.id.toLowerCase()] }));
  }
  // Reconcile equal-version conflicts before any action is staged. Keep
  // distinct versions so opening and closure in one delivery remain events.
  const versions = new Map<string, SyrveObservedOrder[]>();
  for (const order of orders) {
    const key = order.id + ':' + order.timestamp;
    versions.set(key, [...(versions.get(key) || []), order]);
  }
  return { organizationIds: [...organizations], orders: [...versions.values()].flatMap(group => mergeSyrveOrders(group)), ignored };
}
