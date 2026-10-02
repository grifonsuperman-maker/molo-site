import {
  BadGatewayException, BadRequestException, ConflictException, Injectable,
  InternalServerErrorException, Logger, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, randomBytes } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { LogsService } from '../logs/logs.service';
import { TableEntity } from '../tables/entities/table.entity';
import { ConnectSyrveDto, DisconnectSyrveDto, PreviewSyrveTablesDto, SyrveRevisionDto,
  TestSyrveConnectionDto, UpdateSyrveConnectionDto } from './dto/syrve-integration.dto';
import { SyrveIntegration } from './entities/syrve-integration.entity';
import { SyrveTableLink } from './entities/syrve-table-link.entity';
import { SyrveClient, SyrveClientException, SyrveProbeControls } from './syrve-client';
import { buildSyrveMappingPreview } from './syrve-mapping-preview';
import { credentialFingerprint, issuePreviewProof, previewFingerprint, verifyPreviewProof } from './syrve-preview-proof';
import { settingsVersion, staleSyrveSettings, SyrveSettingsSnapshot, SyrveSettingsStore } from './syrve-settings.store';
import { buildSyrveOrderObservation } from './syrve-order-observer';
import { directorOrderDiagnostics } from './syrve-order-diagnostics';
import { diagnoseSyrvePosVersions } from './syrve-pos-version';
import type { SyrveStateCapture } from './syrve-state.store';
import { savedSyrveFingerprint } from './syrve-saved-scope';
import { decryptSyrveCredentials, syrveCredentialsKey } from './syrve-credentials';

type EncryptedValue = { encrypted: string; iv: string; authTag: string };

@Injectable()
export class SyrveIntegrationService {
  private readonly logger = new Logger(SyrveIntegrationService.name);
  constructor(
    private readonly settings: SyrveSettingsStore,
    private readonly logs: LogsService,
    private readonly client: SyrveClient,
    @InjectRepository(TableEntity) private readonly tablesRepo: Repository<TableEntity>,
  ) {}

  private response(snapshot: SyrveSettingsSnapshot) {
    const entity = snapshot.entity;
    return {
      id: entity?.id || '', displayName: entity?.displayName || 'MOLO · Syrve',
      apiBaseUrl: entity?.apiBaseUrl || 'https://api-eu.syrve.live',
      apiLoginMasked: entity?.apiLoginMasked || null,
      hasCredentials: Boolean(entity?.apiLoginEncrypted && entity.apiLoginIv && entity.apiLoginAuthTag),
      organizationId: entity?.organizationId || null, organizationName: entity?.organizationName || null,
      status: entity?.status || 'not_connected', lastCheckedAt: entity?.lastCheckedAt || null,
      connectedAt: entity?.connectedAt || null, lastError: entity?.lastError || null,
      configurationRevision: entity?.configurationRevision || null,
      settingsPrepared: snapshot.prepared, confirmedLinks: snapshot.links.length, syncEnabled: false,
    };
  }

  async getStatus() { return this.response(await this.settings.read()); }

  // Internal worker bridge only, never a controller route. Credentials are
  // decrypted only after the saved configuration and immutable binding match.
  async probeWorkerOrders(captured: SyrveStateCapture, orderIds: string[], controls: SyrveProbeControls) {
    const snapshot = await this.settings.read(), entity = snapshot.entity, expected = captured.state.scope;
    if (!snapshot.prepared || !entity || entity.status !== 'connected' || entity.id !== expected.integrationId
      || entity.configurationRevision !== expected.configurationRevision || entity.organizationId !== expected.organizationId
      || !snapshot.links.some((link) => link.id === captured.linkId && link.integrationId === entity.id
        && link.organizationId === expected.organizationId && link.moloTableId === expected.moloTableId
        && link.syrveTableId === expected.syrveTableId)) throw staleSyrveSettings();
    return this.client.probeOrders(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId,
      [expected.syrveTableId], orderIds, controls);
  }

  private async probeSavedTables(dto: SyrveRevisionDto) {
    const snapshot = await this.checkedRevision(dto);
    const entity = snapshot.entity!;
    if (entity.status !== 'connected' || !entity.organizationId) {
      throw new BadRequestException('Спочатку збережіть і перевірте підключення Syrve.');
    }
    if (!snapshot.links.length) throw new BadRequestException('Спочатку підтвердьте зв’язки столів Syrve.');
    if (snapshot.links.some((link) => link.integrationId !== entity.id ||
        link.organizationId.toLowerCase() !== entity.organizationId!.toLowerCase())) throw staleSyrveSettings();
    const localTables = () => this.tablesRepo.find({ select: { id: true, tableNumber: true, status: true, updatedAt: true } });
    const tables = await localTables();
    if (snapshot.links.some((link) => !tables.some((table) => table.id === link.moloTableId))) throw staleSyrveSettings();
    const before = savedSyrveFingerprint(snapshot, tables);
    const probe = await this.client.probeOrders(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId,
      snapshot.links.map((link) => link.syrveTableId), [...new Set(snapshot.links.flatMap((link) => link.activeSyrveOrderIds))]);
    // No transaction/lock spans HTTP, and even failures do not write settings/logs/state.
    const current = await this.settings.read();
    if (before !== savedSyrveFingerprint(current, await localTables())) throw staleSyrveSettings();
    return { observation: { ...buildSyrveOrderObservation(probe, snapshot.links), configurationRevision: entity.configurationRevision },
      posVersions: diagnoseSyrvePosVersions(probe, snapshot.links) };
  }

  async observeOrders(dto: SyrveRevisionDto) {
    return (await this.probeSavedTables(dto)).observation;
  }

  async orderDiagnostics(dto: SyrveRevisionDto) {
    const { observation, posVersions } = await this.probeSavedTables(dto);
    return directorOrderDiagnostics(observation, posVersions);
  }

  private requirePrepared(snapshot: SyrveSettingsSnapshot) {
    if (!snapshot.prepared) throw new ServiceUnavailableException('Серверна підготовка інтеграції ще не завершена. Збереження зв’язків поки недоступне.');
  }

  private async checkedRevision(dto: SyrveRevisionDto) {
    const snapshot = await this.settings.read();
    this.requirePrepared(snapshot);
    if (!snapshot.entity || snapshot.entity.configurationRevision !== dto.configurationRevision) throw staleSyrveSettings();
    return snapshot;
  }

  private async audit(message: string, metadata: Record<string, unknown>) {
    // A logging outage must not turn an already committed operation into a failure.
    try { await this.logs.create(message, null, metadata); }
    catch { this.logger.warn('Не вдалося записати журнал дії Syrve'); }
  }
  private encryptionKey() {
    return syrveCredentialsKey();
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
    return decryptSyrveCredentials(entity);
  }

  async test(dto: TestSyrveConnectionDto) {
    this.encryptionKey();
    const result = await this.client.checkOrganizations(dto.apiBaseUrl, dto.apiLogin.trim());
    return { message: 'Підключення до Syrve успішно перевірено', apiBaseUrl: result.baseUrl,
      organizations: result.organizations, diagnostics: result.diagnostics };
  }

  async previewTables(dto: PreviewSyrveTablesDto) {
    const key = this.encryptionKey();
    const before = await this.settings.read();
    const catalog = await this.client.getCatalog(dto.apiBaseUrl, dto.apiLogin.trim(), dto.organizationId);
    const tables = await this.tablesRepo.find({ select: { id: true, tableNumber: true }, order: { tableNumber: 'ASC' } });
    const current = await this.settings.read();
    if (JSON.stringify(settingsVersion(before)) !== JSON.stringify(settingsVersion(current))) throw staleSyrveSettings();
    const preview = buildSyrveMappingPreview(catalog, tables, current.links);
    const confirmation = current.prepared ? issuePreviewProof(key, {
      organizationId: catalog.organization.id, version: settingsVersion(current),
      credentials: credentialFingerprint(key, this.client.normalizeBaseUrl(dto.apiBaseUrl), dto.apiLogin.trim()),
      fingerprint: previewFingerprint(catalog, tables, current.links),
    }) : null;
    return { ...preview, confirmation, mappingConfirmationAvailable: Boolean(confirmation && preview.proposals.length),
      diagnostics: { ...preview.diagnostics, warnings: [...preview.diagnostics.warnings,
        ...(!current.prepared ? ['Підтвердження зв’язків поки недоступне: серверна підготовка інтеграції ще не завершена.'] : [])] } };
  }

  async connect(dto: ConnectSyrveDto, actor?: AuthUser) {
    const key = this.encryptionKey();
    const proof = verifyPreviewProof(key, dto.confirmationProof);
    const apiLogin = dto.apiLogin.trim();
    const baseUrl = this.client.normalizeBaseUrl(dto.apiBaseUrl);
    if (proof.organizationId !== dto.organizationId.toLowerCase() ||
        proof.credentials !== credentialFingerprint(key, baseUrl, apiLogin)) throw staleSyrveSettings();
    // Re-read the documented catalog outside the database transaction.
    const catalog = await this.client.getCatalog(baseUrl, apiLogin, dto.organizationId);
    const encrypted = this.encrypt(apiLogin);
    const result = await this.settings.transaction(proof.version, async (manager, current) => {
      if (proof.expires <= Date.now()) throw staleSyrveSettings();
      if (current.links.some((link) => link.organizationId !== catalog.organization.id)) {
        throw new ConflictException('Збережені зв’язки належать іншому ресторану. Автоматична заміна зв’язків заборонена.');
      }
      // Protect number uniqueness including concurrent insert/rename. The lock is
      // held only for local validation and link writes, never during Syrve calls.
      await manager.query('LOCK TABLE "tables" IN SHARE MODE');
      const tables = await manager.getRepository(TableEntity).find({ select: { id: true, tableNumber: true } });
      if (proof.fingerprint !== previewFingerprint(catalog, tables, current.links)) throw staleSyrveSettings();
      const preview = buildSyrveMappingPreview(catalog, tables, current.links);
      const pairs = dto.pairs || [];
      const proposed = new Map(preview.proposals.map((pair) => [pair.moloTableId, pair]));
      const seen = new Set<string>();
      for (const pair of pairs) {
        const candidate = proposed.get(pair.moloTableId.toLowerCase());
        if (!candidate || candidate.syrveTableId !== pair.syrveTableId.toLowerCase() || seen.has(candidate.moloTableId)) {
          throw new BadRequestException('Підтверджувати можна лише унікальні запропоновані пари. Повторіть перевірку.');
        }
        seen.add(candidate.moloTableId);
      }
      const entity = await this.settings.save(manager, { ...current.entity,
        displayName: dto.displayName.trim(), apiBaseUrl: baseUrl,
        apiLoginEncrypted: encrypted.encrypted, apiLoginIv: encrypted.iv,
        apiLoginAuthTag: encrypted.authTag, apiLoginMasked: this.maskLogin(apiLogin),
        organizationId: catalog.organization.id, organizationName: catalog.organization.name,
        status: 'connected', lastCheckedAt: new Date(), connectedAt: new Date(), lastError: null,
      });
      if (pairs.length) {
        await manager.getRepository(SyrveTableLink).insert(pairs.map((pair) => {
          const candidate = proposed.get(pair.moloTableId.toLowerCase())!;
          return { integrationId: entity.id, organizationId: catalog.organization.id,
            moloTableId: candidate.moloTableId, syrveTableId: candidate.syrveTableId,
            lastKnownNumber: candidate.syrveTableNumber, lastSeenAt: new Date(),
            lastSyrveState: 'unknown' as const, activeSyrveOrderIds: [], manuallyFreedSyrveOrderIds: [] };
        }));
      }
      return { entity, prepared: true, links: await manager.getRepository(SyrveTableLink).find() };
    });
    await this.audit('Директор підтвердив налаштування і зв’язки Syrve', {
      organizationId: catalog.organization.id, confirmedPairs: dto.pairs.length,
      actorName: actor?.name || null, actorRole: actor?.role || null,
    });
    return { message: 'Підключення та підтверджені зв’язки збережено',
      confirmedPairs: dto.pairs.length, integration: this.response(result) };
  }

  async recheck(dto: SyrveRevisionDto, actor?: AuthUser) {
    const snapshot = await this.checkedRevision(dto);
    const entity = snapshot.entity!;
    const apiLogin = this.decrypt(entity);
    let result: Awaited<ReturnType<SyrveClient['checkOrganizations']>>;
    try {
      result = await this.client.checkOrganizations(entity.apiBaseUrl, apiLogin);
      if (!result.organizations.some((item) => item.id === entity.organizationId?.toLowerCase())) {
        throw new BadGatewayException('Обрана організація більше не доступна');
      }
    } catch (error: unknown) {
      const safeError = error instanceof SyrveClientException || error instanceof BadGatewayException
        ? error : new InternalServerErrorException('Не вдалося перевірити підключення Syrve');
      await this.settings.transaction(settingsVersion(snapshot), async (manager, current) => {
        await this.settings.save(manager, { ...current.entity, status: 'error', lastCheckedAt: new Date(), lastError: safeError.message });
      });
      throw safeError;
    }
    const updated = await this.settings.transaction(settingsVersion(snapshot), async (manager, current) => ({
      ...current, entity: await this.settings.save(manager, { ...current.entity, status: 'connected',
        lastCheckedAt: new Date(), lastError: null,
        organizationName: result.organizations.find((item) => item.id === entity.organizationId?.toLowerCase())!.name }),
    }));
    await this.audit('Директор перевірив підключення Syrve', { organizationId: entity.organizationId, actorName: actor?.name || null });
    return { message: 'Підключення Syrve працює', integration: this.response(updated) };
  }

  async updateMetadata(dto: UpdateSyrveConnectionDto) {
    const snapshot = await this.checkedRevision(dto);
    const baseUrl = dto.apiBaseUrl === undefined ? undefined : this.client.normalizeBaseUrl(dto.apiBaseUrl);
    const updated = await this.settings.transaction(settingsVersion(snapshot), async (manager, current) => ({
      ...current, entity: await this.settings.save(manager, { ...current.entity,
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
        ...(baseUrl !== undefined ? { apiBaseUrl: baseUrl } : {}),
      }),
    }));
    return this.response(updated);
  }

  async disconnect(dto: DisconnectSyrveDto, actor?: AuthUser) {
    const snapshot = await this.checkedRevision(dto);
    const updated = await this.settings.transaction(settingsVersion(snapshot), async (manager, current) => ({
      ...current, entity: await this.settings.save(manager, { ...current.entity,
        apiLoginEncrypted: null, apiLoginIv: null, apiLoginAuthTag: null, apiLoginMasked: null,
        organizationId: null, organizationName: null, status: 'not_connected',
        lastCheckedAt: new Date(), connectedAt: null, lastError: null }),
    }));
    await this.audit('Директор відключив Syrve Cloud API', { reason: dto.reason || 'Не вказано',
      actorName: actor?.name || null, actorRole: actor?.role || null });
    return { message: 'Syrve відключено. Підтверджені зв’язки збережено', integration: this.response(updated) };
  }

  private maskLogin(value: string) {
    const trimmed = value.trim();
    if (trimmed.length <= 4) return '••••';
    return `${'•'.repeat(Math.min(12, trimmed.length - 4))}${trimmed.slice(-4)}`;
  }
}
