import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { summarizeSyrveWebhookSettings } from './syrve-webhook-diagnostics';
import { hasSyrveWebhookAuthorization, isSyrveWebhookRevision, syrveWebhookToken } from './syrve-webhook';

const STATUSES = ['New', 'Bill', 'Closed', 'Deleted'];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export type SyrveWebhookSetupSettings = { webHooksUri: string | null; authToken: string | null;
  webHooksFilter: Record<string, unknown> | null };
export type SyrveWebhookVerification = {
  addressMatches: boolean; authorizationMatches: boolean; tableFilterPresent: boolean;
  orderStatusesMatch: boolean; itemStatusesMatch: boolean;
};

export function syrveWebhookReceiverUrl(configurationRevision: string): string {
  try {
    if (!isSyrveWebhookRevision(configurationRevision)) throw new Error();
    const configured = process.env.SYRVE_WEBHOOK_BASE_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
    if (!configured || configured.length > 500) throw new Error();
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/'
      || url.search || url.hash || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)
      || !url.hostname.includes('.') || /^[0-9.]+$/.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname)) throw new Error();
    // Never route the token using Host, forwarded headers or a browser URL.
    return url.origin + '/api/syrve-webhook/' + configurationRevision.toLowerCase();
  } catch { throw new ServiceUnavailableException('На сервері потрібно налаштувати публічну HTTPS адресу прийому сповіщень Syrve.'); }
}

export function parseSyrveWebhookSetupSettings(value: unknown): SyrveWebhookSetupSettings {
  summarizeSyrveWebhookSettings(value);
  const settings = value as Record<string, unknown>;
  if (settings.webHooksFilter !== undefined && settings.webHooksFilter !== null && !object(settings.webHooksFilter)) throw new Error();
  const filter = settings.webHooksFilter as Record<string, unknown> | null | undefined;
  if (filter?.tableOrderFilter !== undefined && filter.tableOrderFilter !== null && !object(filter.tableOrderFilter)) throw new Error();
  return { webHooksUri: settings.webHooksUri as string | null, authToken: (settings.authToken as string | null) ?? null,
    webHooksFilter: filter ? structuredClone(filter) : null };
}

function managedRevision(uri: string, target: string): string | null {
  try {
    const url = new URL(uri), expected = new URL(target);
    if (url.origin !== expected.origin || url.username || url.password || url.search || url.hash) return null;
    const revision = url.pathname.slice('/api/syrve-webhook/'.length);
    return url.pathname.startsWith('/api/syrve-webhook/') && isSyrveWebhookRevision(revision) ? revision.toLowerCase() : null;
  } catch { return null; }
}

export function verifySyrveWebhookSettings(settings: SyrveWebhookSetupSettings, target: string): SyrveWebhookVerification {
  const revision = managedRevision(target, target), filter = settings.webHooksFilter?.tableOrderFilter;
  const statuses = object(filter) ? filter.orderStatuses : null;
  return {
    addressMatches: Boolean(revision && settings.webHooksUri === target),
    authorizationMatches: Boolean(revision && hasSyrveWebhookAuthorization(settings.authToken, revision)),
    tableFilterPresent: object(filter),
    orderStatusesMatch: Array.isArray(statuses) && statuses.length === STATUSES.length
      && STATUSES.every(status => statuses.includes(status)),
    itemStatusesMatch: object(filter) && (filter.itemStatuses === null || filter.itemStatuses === undefined),
  };
}

export function configuredSyrveWebhook(settings: SyrveWebhookSetupSettings, target: string): boolean {
  return Object.values(verifySyrveWebhookSettings(settings, target)).every(value => value === true);
}

export function syrveWebhookUpdatePayload(settings: SyrveWebhookSetupSettings, organizationId: string, target: string) {
  const revision = managedRevision(target, target);
  if (!revision || !isSyrveWebhookRevision(organizationId)) throw new Error();
  if (settings.webHooksUri?.trim()) {
    const previous = managedRevision(settings.webHooksUri, target);
    if (!previous || !hasSyrveWebhookAuthorization(settings.authToken, previous)) {
      throw new ConflictException('Для цього API-ключа вже задано інший приймач сповіщень. Його не змінено. Потрібно перевірити налаштування Syrve.');
    }
  }
  const previousFilter = settings.webHooksFilter?.tableOrderFilter;
  return { organizationId: organizationId.toLowerCase(), webHooksUri: target, authToken: syrveWebhookToken(revision),
    webHooksFilter: { ...settings.webHooksFilter, tableOrderFilter: { ...(object(previousFilter) ? previousFilter : {}),
      orderStatuses: [...STATUSES], itemStatuses: null,
      errors: object(previousFilter) && typeof previousFilter.errors === 'boolean' ? previousFilter.errors : false } } };
}
