import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { parseRestaurantSections, parseTerminalGroups, SyrveCatalogValidationError, type SyrveCatalog } from './syrve-catalog';
import { TABLE_ORDER_BATCH_SIZE, ORDER_ID_BATCH_SIZE, MAX_CATALOG_TABLES, MAX_RESPONSE_ORDERS,
  mergeSyrveOrders, observationIds, parsePosAvailability, parseSyrveOrders, SyrveOrderValidationError,
  type ObservationCheckName, type SyrveObservedOrder, type SyrveOrderProbe } from './syrve-order-observer';

const API_ORIGIN = 'https://api-eu.syrve.live';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const OBSERVATION_TIMEOUT_MS = 45_000;
const MAX_OBSERVATION_REQUESTS = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS = {
  SYRVE_AUTH_FAILED: 'Syrve відхилив дані доступу. Перевірте API-ключ і налаштування підключення.',
  SYRVE_ACCESS_DENIED: 'Syrve не надав права для цієї перевірки.',
  SYRVE_RATE_LIMITED: 'Syrve тимчасово обмежив кількість запитів. Спробуйте пізніше.',
  SYRVE_TIMEOUT: 'Syrve не відповів протягом 12 секунд.',
  SYRVE_UNAVAILABLE: 'Не вдалося встановити захищене з’єднання із Syrve.',
  SYRVE_INVALID_RESPONSE: 'Syrve повернув неочікувану відповідь. Синхронізацію не ввімкнено.',
  SYRVE_NO_ORGANIZATIONS: 'У доступі Syrve не знайдено активних організацій.',
  SYRVE_ORGANIZATION_UNAVAILABLE: 'Обрана організація більше не доступна у Syrve.',
  SYRVE_OBSERVATION_LIMIT: 'Перевірку зупинено на безпечному ліміті запитів. Збережений стан не змінено.',
} as const;

export class SyrveClientException extends BadGatewayException {
  constructor(code: keyof typeof ERRORS) {
    // Never include an upstream body, URL, token or fetch error in an API error.
    super({ statusCode: 502, code, message: ERRORS[code] });
  }
}

export type SyrveOrganization = { id: string; name: string };
type AuthMode = 'v2' | 'legacy_v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class SyrveClient {
  normalizeBaseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException('Некоректна адреса Syrve API');
    }
    // Only the origin verified against the official OpenAPI is supported here.
    // Reject paths, credentials and redirects rather than forwarding secrets.
    if (url.origin !== API_ORIGIN || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new BadRequestException('Використовуйте офіційну адресу https://api-eu.syrve.live');
    }
    return API_ORIGIN;
  }

  private authentication(apiLogin: string): { path: string; body: object; mode: AuthMode } {
    const apiKey = apiLogin.trim();
    if (apiKey.length < 5 || apiKey.length > 1000) {
      throw new BadRequestException('Введіть коректний API-логін Syrve');
    }
    const appId = process.env.SYRVE_APP_ID?.trim();
    const clientSecret = process.env.SYRVE_APP_CLIENT_SECRET?.trim();
    if (appId || clientSecret) {
      if (!appId || !UUID.test(appId) || !clientSecret) {
        throw new InternalServerErrorException('На сервері не налаштовано дані застосунку Syrve');
      }
      return { path: '/api/v2/access_token', body: { apiKey, appId, clientSecret }, mode: 'v2' };
    }
    // Preserve existing API-login compatibility. No fallback after a v2 failure.
    return { path: '/api/1/access_token', body: { apiLogin: apiKey }, mode: 'legacy_v1' };
  }

  private async postJson(path: string, body: object, token?: string, deadline?: number): Promise<unknown> {
    const remaining = deadline === undefined ? REQUEST_TIMEOUT_MS : Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) throw new SyrveClientException('SYRVE_TIMEOUT');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(`${API_ORIGIN}${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        const code = response.status === 401 ? 'SYRVE_AUTH_FAILED'
          : response.status === 403 ? 'SYRVE_ACCESS_DENIED'
          : response.status === 429 ? 'SYRVE_RATE_LIMITED'
          : response.status === 408 || response.status === 504 ? 'SYRVE_TIMEOUT'
          : 'SYRVE_UNAVAILABLE';
        throw new SyrveClientException(code);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(contentType) ||
          Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => undefined);
            throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
      }
    } catch (error: unknown) {
      if (error instanceof SyrveClientException) throw error;
      throw new SyrveClientException(controller.signal.aborted ? 'SYRVE_TIMEOUT' : 'SYRVE_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async openSession(apiBaseUrl: string, apiLogin: string, deadline?: number) {
    const baseUrl = this.normalizeBaseUrl(apiBaseUrl);
    const auth = this.authentication(apiLogin);
    const payload = await this.postJson(auth.path, auth.body, undefined, deadline);
    if (!isRecord(payload) || typeof payload.token !== 'string' ||
        !payload.token || payload.token.length > 16_384 || /\s/.test(payload.token)) {
      throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
    }
    // Tokens live only within this backend request; they are never persisted.
    const result = await this.postJson('/api/1/organizations', {
      organizationIds: null,
      returnAdditionalInfo: false,
      includeDisabled: false,
    }, payload.token, deadline);
    if (!isRecord(result) || !Array.isArray(result.organizations)) {
      throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
    }
    const ids = new Set<string>();
    const organizations: SyrveOrganization[] = result.organizations.map((item: unknown) => {
      if (!isRecord(item) || typeof item.id !== 'string' || !UUID.test(item.id) ||
          (item.name !== null && typeof item.name !== 'string')) {
        throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
      }
      const id = item.id.toLowerCase();
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (ids.has(id) || name.length > 240) {
        throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
      }
      ids.add(id);
      return { id, name: name || 'Організація без назви' };
    });
    if (!organizations.length) throw new SyrveClientException('SYRVE_NO_ORGANIZATIONS');
    return {
      token: payload.token,
      baseUrl,
      organizations,
      diagnostics: {
        authentication: { status: 'ok', method: auth.mode, deprecated: auth.mode === 'legacy_v1' },
        organizations: { status: 'ok', count: organizations.length },
        tables: { status: 'not_checked' },
        orders: { status: 'not_checked' },
        syncEnabled: false,
      },
    };
  }

  async checkOrganizations(apiBaseUrl: string, apiLogin: string) {
    const { baseUrl, organizations, diagnostics } = await this.openSession(apiBaseUrl, apiLogin);
    return { baseUrl, organizations, diagnostics };
  }

  async getCatalog(apiBaseUrl: string, apiLogin: string, organizationId: string): Promise<SyrveCatalog> {
    if (!UUID.test(organizationId)) throw new BadRequestException('Оберіть коректну організацію Syrve');
    const session = await this.openSession(apiBaseUrl, apiLogin);
    const organization = session.organizations.find((item) => item.id === organizationId.toLowerCase());
    if (!organization) throw new BadRequestException('Обрана організація більше не доступна у Syrve');
    try {
      const terminalGroups = parseTerminalGroups(await this.postJson('/api/1/terminal_groups', {
        organizationIds: [organization.id], includeDisabled: false,
      }, session.token), organization.id);
      const catalog = terminalGroups.active.length
        ? parseRestaurantSections(await this.postJson('/api/1/reserve/available_restaurant_sections', {
          terminalGroupIds: terminalGroups.active.map((group) => group.id), returnSchema: false,
        }, session.token), terminalGroups.active.map((group) => group.id))
        : { sectionsCount: 0, tables: [] };
      return { organization, terminalGroups, ...catalog };
    } catch (error: unknown) {
      if (error instanceof SyrveCatalogValidationError) throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
      throw error;
    }
  }

  async probeOrders(apiBaseUrl: string, apiLogin: string, organizationId: string,
    tableIds: string[], knownOrderIds: string[]): Promise<SyrveOrderProbe> {
    // Validate scope before authentication; callers cannot expand it with arbitrary IDs.
    this.normalizeBaseUrl(apiBaseUrl);
    if (!UUID.test(organizationId)) throw new BadRequestException('Оберіть коректну організацію Syrve');
    let requestedTables: string[], requestedOrders: string[];
    try {
      // The scope comes from saved UUID links, not caller-supplied API IDs. Bound
      // transport batches/deadlines instead of rejecting valid saved link counts.
      requestedTables = observationIds(tableIds, Number.MAX_SAFE_INTEGER);
      requestedOrders = observationIds(knownOrderIds, Number.MAX_SAFE_INTEGER);
      if (!requestedTables.length) throw new SyrveOrderValidationError();
    } catch {
      throw new BadRequestException('Для перевірки потрібні унікальні підтверджені UUID столів і замовлень.');
    }
    const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
    const probe: SyrveOrderProbe = {
      organizationId: organizationId.toLowerCase(), startedAt: new Date().toISOString(), completedAt: '', authentication: null,
      checks: Object.fromEntries(['connection', 'terminalGroups', 'restaurantSections', 'posAvailability', 'ordersByTable', 'ordersById']
        .map((key) => [key, { status: 'not_checked', code: null }])) as SyrveOrderProbe['checks'],
      terminalGroups: null, catalogTables: null, availability: null, byTable: null, byId: null,
    };
    const finish = () => ({ ...probe, completedAt: new Date().toISOString() });
    const check = async <T>(key: ObservationCheckName, action: () => Promise<T>): Promise<T | null> => {
      try {
        const value = await action();
        probe.checks[key] = { status: 'ok', code: null };
        return value;
      } catch (error: unknown) {
        const code = error instanceof SyrveClientException ? (error.getResponse() as { code: string }).code
          : error instanceof SyrveCatalogValidationError || error instanceof SyrveOrderValidationError
            ? 'SYRVE_INVALID_RESPONSE' : 'SYRVE_UNAVAILABLE';
        probe.checks[key] = { status: 'error', code };
        return null;
      }
    };
    const session = await check('connection', () => this.openSession(apiBaseUrl, apiLogin, deadline));
    if (!session) return finish();
    probe.authentication = session.diagnostics.authentication.method;
    if (!session.organizations.some((item) => item.id === probe.organizationId)) {
      probe.checks.connection = { status: 'error', code: 'SYRVE_ORGANIZATION_UNAVAILABLE' };
      return finish();
    }
    let requests = 2; // Authentication and organizations share the same probe budget.
    const post = (path: string, body: object) => {
      if (Date.now() >= deadline) throw new SyrveClientException('SYRVE_TIMEOUT');
      if (requests >= MAX_OBSERVATION_REQUESTS) throw new SyrveClientException('SYRVE_OBSERVATION_LIMIT');
      requests++;
      return this.postJson(path, body, session.token, deadline);
    };
    const groups = await check('terminalGroups', async () => parseTerminalGroups(await post('/api/1/terminal_groups', {
      organizationIds: [probe.organizationId], includeDisabled: false,
    }), probe.organizationId));
    if (!groups) return finish();
    probe.terminalGroups = { active: groups.active.map(({ id }) => ({ id })), sleeping: groups.sleeping.map(({ id }) => ({ id })) };
    if (!groups.active.length) return finish();
    const groupIds = groups.active.map((group) => group.id);
    const sections = await check('restaurantSections', async () => {
      const parsed = parseRestaurantSections(await post('/api/1/reserve/available_restaurant_sections', {
        terminalGroupIds: groupIds, returnSchema: false,
      }), groupIds);
      const ids = parsed.tables.map((table) => table.id);
      if (ids.length > MAX_CATALOG_TABLES || new Set(ids).size !== ids.length) throw new SyrveOrderValidationError();
      return parsed.tables.map(({ id, terminalGroupId, isDeleted }) => ({ id, terminalGroupId, isDeleted }));
    });
    if (!sections) return finish();
    probe.catalogTables = sections;
    const availability = await check('posAvailability', async () => parsePosAvailability(await post('/api/1/terminal_groups/is_alive', {
      organizationIds: [probe.organizationId], terminalGroupIds: groupIds,
    }), probe.organizationId, groupIds));
    if (!availability) return finish();
    probe.availability = availability;
    const eligibleTables = requestedTables.filter((id) => sections.some((table) => table.id === id && !table.isDeleted
      && availability.some((group) => group.terminalGroupId === table.terminalGroupId && group.isAlive)));
    if (!eligibleTables.length) return finish();
    const readBatches = (key: 'ordersByTable' | 'ordersById', ids: string[], size: number) => check(key, async () => {
      let collected: SyrveObservedOrder[] = [];
      for (let offset = 0; offset < ids.length; offset += size) {
        const batch = ids.slice(offset, offset + size);
        const scope = key === 'ordersByTable' ? { tableIds: batch } : { orderIds: batch };
        const payload = key === 'ordersByTable'
          ? await post('/api/1/order/by_table', { organizationIds: [probe.organizationId], tableIds: batch, statuses: null })
          : await post('/api/1/order/by_id', { organizationIds: [probe.organizationId], orderIds: batch, posOrderIds: null });
        // An order may span tables in different chunks. Reconcile its versions;
        // only duplicate UUIDs inside one provider response are malformed.
        collected = mergeSyrveOrders(collected, parseSyrveOrders(payload, probe.organizationId, scope));
        if (collected.length > MAX_RESPONSE_ORDERS) throw new SyrveOrderValidationError();
      }
      // Publish this channel only after every chunk passed; no partial closures.
      return collected;
    });
    probe.byTable = await readBatches('ordersByTable', eligibleTables, TABLE_ORDER_BATCH_SIZE);
    if (!probe.byTable) return finish();
    if (requestedOrders.length) {
      probe.byId = await readBatches('ordersById', requestedOrders, ORDER_ID_BATCH_SIZE);
    }
    return finish();
  }
}
