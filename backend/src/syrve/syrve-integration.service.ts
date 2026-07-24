import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { LogsService } from '../logs/logs.service';
import {
  ConnectSyrveDto,
  TestSyrveConnectionDto,
  UpdateSyrveConnectionDto,
} from './dto/syrve-integration.dto';
import { SyrveIntegration } from './entities/syrve-integration.entity';

type SyrveOrganization = {
  id: string;
  name: string;
};

type EncryptedValue = {
  encrypted: string;
  iv: string;
  authTag: string;
};

@Injectable()
export class SyrveIntegrationService {
  constructor(
    @InjectRepository(SyrveIntegration)
    private readonly repo: Repository<SyrveIntegration>,
    private readonly logs: LogsService,
  ) {}

  private async findOrCreate() {
    const existing = await this.repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (existing[0]) return existing[0];

    return this.repo.save(
      this.repo.create({
        displayName: 'MOLO · Syrve',
        apiBaseUrl: 'https://api-eu.syrve.live',
        apiLoginEncrypted: null,
        apiLoginIv: null,
        apiLoginAuthTag: null,
        apiLoginMasked: null,
        organizationId: null,
        organizationName: null,
        status: 'not_connected',
        lastCheckedAt: null,
        connectedAt: null,
        lastError: null,
      }),
    );
  }

  private response(entity: SyrveIntegration) {
    return {
      id: entity.id,
      displayName: entity.displayName,
      apiBaseUrl: entity.apiBaseUrl,
      apiLoginMasked: entity.apiLoginMasked,
      hasCredentials: Boolean(
        entity.apiLoginEncrypted && entity.apiLoginIv && entity.apiLoginAuthTag,
      ),
      organizationId: entity.organizationId,
      organizationName: entity.organizationName,
      status: entity.status,
      lastCheckedAt: entity.lastCheckedAt,
      connectedAt: entity.connectedAt,
      lastError: entity.lastError,
      syncEnabled: false,
    };
  }

  async getStatus() {
    return this.response(await this.findOrCreate());
  }

  private encryptionKey() {
    const secret = process.env.SYRVE_CREDENTIALS_SECRET || process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
      throw new InternalServerErrorException(
        'На сервері не налаштовано SYRVE_CREDENTIALS_SECRET',
      );
    }
    return createHash('sha256').update(secret).digest();
  }

  private encrypt(value: string): EncryptedValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(entity: SyrveIntegration) {
    if (!entity.apiLoginEncrypted || !entity.apiLoginIv || !entity.apiLoginAuthTag) {
      throw new BadRequestException('Дані доступу Syrve ще не збережені');
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(entity.apiLoginIv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(entity.apiLoginAuthTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(entity.apiLoginEncrypted, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new InternalServerErrorException('Не вдалося розшифрувати дані доступу Syrve');
    }
  }

  private normalizeBaseUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException('Некоректна адреса Syrve API');
    }

    if (url.protocol !== 'https:') {
      throw new BadRequestException('Syrve API має використовувати захищений HTTPS');
    }

    const host = url.hostname.toLowerCase();
    const allowed =
      host === 'syrve.live' ||
      host.endsWith('.syrve.live') ||
      host === 'iiko.cloud' ||
      host.endsWith('.iiko.cloud');

    if (!allowed) {
      throw new BadRequestException(
        'Дозволені лише офіційні адреси Syrve Cloud API',
      );
    }

    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  private async postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }

      if (!response.ok) {
        const detail =
          payload?.errorDescription ||
          payload?.message ||
          payload?.error ||
          `HTTP ${response.status}`;
        throw new BadGatewayException(`Syrve: ${String(detail).slice(0, 300)}`);
      }

      return payload as T;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new BadGatewayException('Syrve не відповів протягом 12 секунд');
      }
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Не вдалося встановити захищене з’єднання із Syrve');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchOrganizations(apiBaseUrl: string, apiLogin: string) {
    const baseUrl = this.normalizeBaseUrl(apiBaseUrl);
    const auth = await this.postJson<{ token?: string } | string>(
      `${baseUrl}/api/1/access_token`,
      { apiLogin },
    );
    const token = typeof auth === 'string' ? auth : auth?.token;
    if (!token) throw new BadGatewayException('Syrve не повернув токен доступу');

    const payload = await this.postJson<any>(
      `${baseUrl}/api/1/organizations`,
      {
        organizationIds: null,
        returnAdditionalInfo: true,
        includeDisabled: false,
      },
      token,
    );

    const source = Array.isArray(payload) ? payload : payload?.organizations;
    if (!Array.isArray(source)) {
      throw new BadGatewayException('Syrve не повернув список організацій');
    }

    const organizations: SyrveOrganization[] = source
      .map((item: any) => ({
        id: String(item?.id || item?.organizationId || ''),
        name: String(item?.name || item?.organizationName || ''),
      }))
      .filter((item: SyrveOrganization) => item.id && item.name);

    if (!organizations.length) {
      throw new BadGatewayException('У доступі Syrve не знайдено активних організацій');
    }

    return { baseUrl, organizations };
  }

  async test(dto: TestSyrveConnectionDto) {
    const result = await this.fetchOrganizations(dto.apiBaseUrl, dto.apiLogin.trim());
    return {
      message: 'Підключення до Syrve успішно перевірено',
      apiBaseUrl: result.baseUrl,
      organizations: result.organizations,
    };
  }

  async connect(dto: ConnectSyrveDto, actor?: AuthUser) {
    const apiLogin = dto.apiLogin.trim();
    const result = await this.fetchOrganizations(dto.apiBaseUrl, apiLogin);
    const organization = result.organizations.find(
      (item) => item.id === dto.organizationId,
    );
    if (!organization) {
      throw new BadRequestException('Обрана організація більше не доступна у Syrve');
    }

    const encrypted = this.encrypt(apiLogin);
    const entity = await this.findOrCreate();
    entity.displayName = dto.displayName.trim();
    entity.apiBaseUrl = result.baseUrl;
    entity.apiLoginEncrypted = encrypted.encrypted;
    entity.apiLoginIv = encrypted.iv;
    entity.apiLoginAuthTag = encrypted.authTag;
    entity.apiLoginMasked = this.maskLogin(apiLogin);
    entity.organizationId = organization.id;
    entity.organizationName = organization.name;
    entity.status = 'connected';
    entity.lastCheckedAt = new Date();
    entity.connectedAt = new Date();
    entity.lastError = null;

    await this.repo.save(entity);
    await this.logs.create('Директор підключив Syrve Cloud API', null, {
      organizationId: organization.id,
      organizationName: organization.name,
      apiBaseUrl: result.baseUrl,
      actorName: actor?.name || null,
      actorRole: actor?.role || null,
    });

    return {
      message: 'Syrve підключено',
      integration: this.response(entity),
    };
  }

  async recheck(actor?: AuthUser) {
    const entity = await this.findOrCreate();
    const apiLogin = this.decrypt(entity);

    try {
      const result = await this.fetchOrganizations(entity.apiBaseUrl, apiLogin);
      const organization = result.organizations.find(
        (item) => item.id === entity.organizationId,
      );
      if (!organization) {
        throw new BadGatewayException('Обрана організація більше не доступна');
      }

      entity.status = 'connected';
      entity.lastCheckedAt = new Date();
      entity.lastError = null;
      entity.organizationName = organization.name;
      await this.repo.save(entity);
      await this.logs.create('Директор перевірив підключення Syrve', null, {
        organizationId: entity.organizationId,
        actorName: actor?.name || null,
      });
      return {
        message: 'Підключення Syrve працює',
        integration: this.response(entity),
      };
    } catch (error: any) {
      entity.status = 'error';
      entity.lastCheckedAt = new Date();
      entity.lastError = String(error?.message || 'Невідома помилка').slice(0, 500);
      await this.repo.save(entity);
      throw error;
    }
  }

  async updateMetadata(dto: UpdateSyrveConnectionDto) {
    const entity = await this.findOrCreate();
    if (dto.displayName !== undefined) entity.displayName = dto.displayName.trim();
    if (dto.apiBaseUrl !== undefined) {
      entity.apiBaseUrl = this.normalizeBaseUrl(dto.apiBaseUrl);
    }
    await this.repo.save(entity);
    return this.response(entity);
  }

  async disconnect(reason: string | undefined, actor?: AuthUser) {
    const entity = await this.findOrCreate();
    entity.apiLoginEncrypted = null;
    entity.apiLoginIv = null;
    entity.apiLoginAuthTag = null;
    entity.apiLoginMasked = null;
    entity.organizationId = null;
    entity.organizationName = null;
    entity.status = 'not_connected';
    entity.lastCheckedAt = new Date();
    entity.connectedAt = null;
    entity.lastError = null;
    await this.repo.save(entity);

    await this.logs.create('Директор відключив Syrve Cloud API', null, {
      reason: String(reason || 'Не вказано').slice(0, 300),
      actorName: actor?.name || null,
      actorRole: actor?.role || null,
    });

    return {
      message: 'Syrve відключено',
      integration: this.response(entity),
    };
  }

  private maskLogin(value: string) {
    const trimmed = value.trim();
    if (trimmed.length <= 4) return '••••';
    return `${'•'.repeat(Math.min(12, trimmed.length - 4))}${trimmed.slice(-4)}`;
  }
}
