import { BadGatewayException, BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';

const API_ORIGIN = 'https://api-eu.syrve.live';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS = {
  SYRVE_AUTH_FAILED: 'Syrve відхилив дані доступу. Перевірте API-ключ і налаштування підключення.',
  SYRVE_ACCESS_DENIED: 'Syrve не надав права для цієї перевірки.',
  SYRVE_RATE_LIMITED: 'Syrve тимчасово обмежив кількість запитів. Спробуйте пізніше.',
  SYRVE_TIMEOUT: 'Syrve не відповів протягом 12 секунд.',
  SYRVE_UNAVAILABLE: 'Не вдалося встановити захищене з’єднання із Syrve.',
  SYRVE_INVALID_RESPONSE: 'Syrve повернув неочікувану відповідь. Синхронізацію не ввімкнено.',
  SYRVE_NO_ORGANIZATIONS: 'У доступі Syrve не знайдено активних організацій.',
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

  private async postJson(path: string, body: object, token?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

  async checkOrganizations(apiBaseUrl: string, apiLogin: string) {
    const baseUrl = this.normalizeBaseUrl(apiBaseUrl);
    const auth = this.authentication(apiLogin);
    const payload = await this.postJson(auth.path, auth.body);
    if (!isRecord(payload) || typeof payload.token !== 'string' ||
        !payload.token || payload.token.length > 16_384 || /\s/.test(payload.token)) {
      throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
    }
    // Tokens live only within this backend request; they are never persisted.
    const result = await this.postJson('/api/1/organizations', {
      organizationIds: null,
      returnAdditionalInfo: false,
      includeDisabled: false,
    }, payload.token);
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
}
