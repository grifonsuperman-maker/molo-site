import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable,
  InternalServerErrorException, Logger, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, randomBytes } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { LogsService } from '../logs/logs.service';
import { TableEntity } from '../tables/entities/table.entity';
import { ConnectSyrveDto, DisconnectSyrveDto, ResetSyrveBindingsDto, PreviewSyrveTablesDto, SyrveRevisionDto, SyrveBillDiagnosticsDto, SyrvePosBillDiagnosticsDto,
  TestSyrveConnectionDto, UpdateSyrveConnectionDto } from './dto/syrve-integration.dto';
import { SyrveIntegration } from './entities/syrve-integration.entity';
import { SyrveTableLink } from './entities/syrve-table-link.entity';
import { SyrveClient, SyrveClientException, SyrveBatchProbeControls, SyrveLoadedProbeControls } from './syrve-client';
import { SyrveActivationStore } from './syrve-activation.store';
import { buildSyrveMappingPreview } from './syrve-mapping-preview';
import { credentialFingerprint, issuePreviewProof, previewFingerprint, verifyPreviewProof } from './syrve-preview-proof';
import { settingsVersion, staleSyrveSettings, SyrveSettingsSnapshot, SyrveSettingsStore } from './syrve-settings.store';
import { buildSyrveOrderObservation } from './syrve-order-observer';
import { directorOrderDiagnostics } from './syrve-order-diagnostics';
import { diagnoseSyrvePosVersions } from './syrve-pos-version';
import { syrveCaptureContext, type SyrveStateCapture } from './syrve-state.store';
import { savedSyrveFingerprint } from './syrve-saved-scope';
import { decryptSyrveCredentials, syrveCredentialsKey } from './syrve-credentials';
import type { SyrveBillReadResult } from './syrve-bill-diagnostics';

type EncryptedValue = { encrypted: string; iv: string; authTag: string };

@Injectable()
export class SyrveIntegrationService {
  private readonly logger = new Logger(SyrveIntegrationService.name);
  constructor(
    private readonly settings: SyrveSettingsStore,
    private readonly logs: LogsService,
    private readonly client: SyrveClient,
    @InjectRepository(TableEntity) private readonly tablesRepo: Repository<TableEntity>,
    private readonly activation: SyrveActivationStore,
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

  async getStatus() {
    const snapshot = await this.settings.read();
    return { ...this.response(snapshot), syncEnabled: Boolean((await this.activation?.read(snapshot))?.enabled) };
  }

  // Internal worker bridge only, never a controller route. Credentials are
  // decrypted only after the saved configuration and immutable binding match.
  async probeWorkerOrders(captured: SyrveStateCapture, orderIds: string[], controls: SyrveLoadedProbeControls) {
    const snapshot = await this.settings.read(), entity = snapshot.entity, expected = captured.state.scope;
    if (!snapshot.prepared || !entity || entity.status !== 'connected' || entity.id !== expected.integrationId
      || entity.configurationRevision !== expected.configurationRevision || entity.organizationId !== expected.organizationId
      || !snapshot.links.some((link) => link.id === captured.linkId && link.integrationId === entity.id
        && link.organizationId === expected.organizationId && link.moloTableId === expected.moloTableId
        && link.syrveTableId === expected.syrveTableId)) throw staleSyrveSettings();
    if (!this.activation || !(await this.activation.read(snapshot)).enabled) throw staleSyrveSettings();
    return this.client.probeLoadedOrders(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId,
      [expected.syrveTableId], orderIds, controls);
  }

  async probeWorkerBatch(captures: SyrveStateCapture[], leaseId: string, controls: SyrveBatchProbeControls) {
    const snapshot = await this.settings.read(), entity = snapshot.entity;
    if (!snapshot.prepared || !entity || entity.status !== 'connected' || !captures.length
      || !this.activation || !(await this.activation.read(snapshot)).enabled) throw staleSyrveSettings();
    for (const captured of captures) {
      const expected = captured.state.scope;
      if (entity.id !== expected.integrationId || entity.configurationRevision !== expected.configurationRevision
        || entity.organizationId !== expected.organizationId || !snapshot.links.some(link => link.id === captured.linkId
          && link.integrationId === entity.id && link.organizationId === expected.organizationId
          && link.moloTableId === expected.moloTableId && link.syrveTableId === expected.syrveTableId)) throw staleSyrveSettings();
    }
    const probes = await this.client.probeLoadedOrderBatch(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId!,
      captures.map(captured => ({ tableId: captured.state.scope.syrveTableId, orderIdBatches: captured.orderIds,
        visibilityContext: syrveCaptureContext(leaseId, captured) })), { ...controls, configurationRevision: entity.configurationRevision });
    // Transport diagnostics only: a completed/empty read is not an applied
    // status. Log bounded counts and informational numbers, never UUIDs,
    // credentials, versions, order bodies or customer data.
    const observed = captures.map((captured, index) => {
      const tableNumber = snapshot.links.find(link => link.id === captured.linkId)?.lastKnownNumber;
      const own = probes[index];
      if (own === null) return { tableNumber, readCompleted: false };
      const counts = (channel: 'byTable' | 'byId') => Object.fromEntries(['open', 'closed', 'unknown'].map(state =>
        [state, new Set(own.flatMap(probe => probe[channel] || []).filter(order => order.state === state).map(order => order.id)).size]));
      return { tableNumber, readCompleted: true, byTable: counts('byTable'), byId: counts('byId') };
    });
    this.logger.log('Спостереження Syrve: ' + JSON.stringify(observed));
    return captures.map((captured, index) => probes[index] === null ? null
      : captured.orderIds.map((orderIds, page) => ({ orderIds, probe: probes[index]![page] })));
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

  private async billScope(dto: SyrveRevisionDto) {
    const snapshot = await this.checkedRevision(dto), entity = snapshot.entity!;
    if (entity.status !== 'connected' || !entity.organizationId) {
      throw new BadRequestException('Спочатку збережіть і перевірте підключення Syrve.');
    }
    // Worker ledger/staff status updates do not invalidate a read-only identity
    // lookup. Credentials, configuration and UUID bindings must remain current.
    const scope = (saved: SyrveSettingsSnapshot) => JSON.stringify({
      prepared: saved.prepared, version: settingsVersion(saved),
      connection: saved.entity && [saved.entity.status, saved.entity.organizationId, saved.entity.apiBaseUrl,
        saved.entity.apiLoginEncrypted, saved.entity.apiLoginIv, saved.entity.apiLoginAuthTag],
      links: saved.links.map(link => [link.id, link.integrationId, link.organizationId, link.moloTableId,
        link.syrveTableId, link.lastKnownNumber]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    });
    const expected = scope(snapshot);
    const guard = async () => { if (scope(await this.settings.read()) !== expected) throw staleSyrveSettings(); };
    return { snapshot, entity, guard };
  }

  async billDiagnostics(dto: SyrveBillDiagnosticsDto) {
    const { snapshot, entity, guard } = await this.billScope(dto);
    const result = await this.client.lookupBill(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId,
      dto.orderId, guard);
    return this.billReport(snapshot, result, dto.orderId, guard);
  }

  async billRegisters(dto: SyrveRevisionDto) {
    const { entity, guard } = await this.billScope(dto);
    const result = await this.client.billRegisters(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId!, guard);
    await guard();
    return { configurationRevision: entity.configurationRevision, organizationId: entity.organizationId!.toLowerCase(),
      checkedAt: result.checkedAt, registers: result.registers };
  }

  async posBillDiagnostics(dto: SyrvePosBillDiagnosticsDto) {
    if (dto.confirmed !== true) throw new BadRequestException('Підтвердіть завантаження цього рахунку з обраної касової групи.');
    const { snapshot, entity, guard } = await this.billScope(dto);
    const result = await this.client.loadAndLookupBill(entity.apiBaseUrl, this.decrypt(entity), entity.organizationId!,
      dto.orderId, dto.terminalGroupId, guard);
    return this.billReport(snapshot, result, dto.orderId, guard);
  }

  private async billReport(snapshot: SyrveSettingsSnapshot, result: SyrveBillReadResult, requestedId: string, guard: () => Promise<void>) {
    const entity = snapshot.entity!;
    const local = await this.tablesRepo.find({ select: { id: true, tableNumber: true } });
    await guard();
    const order = result.order;
    return { configurationRevision: entity.configurationRevision, organizationId: entity.organizationId.toLowerCase(),
      requestedId: requestedId.toLowerCase(), startedAt: result.startedAt, checkedAt: result.checkedAt,
      lookup: result.lookup, found: Boolean(order), statusesApplied: false, bindingsApplied: false,
      ...(result.posLoading ? { posLoading: result.posLoading } : {}),
      order: order ? { id: order.id, posId: order.posId, timestamp: order.timestamp, number: order.number,
        sum: order.sum, status: order.status, creationStatus: order.creationStatus, terminalGroupId: order.terminalGroupId,
        tables: order.tableIds.map(syrveTableId => {
          const links = snapshot.links.filter(link => link.integrationId === entity.id
            && link.organizationId.toLowerCase() === entity.organizationId!.toLowerCase() && link.syrveTableId.toLowerCase() === syrveTableId);
          const table = links.length === 1 ? local.find(row => row.id === links[0].moloTableId) : null;
          return { syrveTableId, moloTableNumber: table?.tableNumber || null };
        }) } : null };
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
      await this.activation?.requireDisabled(current, manager);
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
    await this.activation?.requireDisabled(snapshot);
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
        await this.activation?.requireDisabled(current, manager);
        await this.settings.save(manager, { ...current.entity, status: 'error', lastCheckedAt: new Date(), lastError: safeError.message });
      });
      throw safeError;
    }
    const updated = await this.settings.transaction(settingsVersion(snapshot), async (manager, current) => {
      await this.activation?.requireDisabled(current, manager);
      return { ...current, entity: await this.settings.save(manager, { ...current.entity, status: 'connected',
        lastCheckedAt: new Date(), lastError: null,
        organizationName: result.organizations.find((item) => item.id === entity.organizationId?.toLowerCase())!.name }),
      };
    });
    await this.audit('Директор перевірив підключення Syrve', { organizationId: entity.organizationId, actorName: actor?.name || null });
    return { message: 'Підключення Syrve працює', integration: this.response(updated) };
  }

  async updateMetadata(dto: UpdateSyrveConnectionDto) {
    const snapshot = await this.checkedRevision(dto);
    const baseUrl = dto.apiBaseUrl === undefined ? undefined : this.client.normalizeBaseUrl(dto.apiBaseUrl);
    const updated = await this.settings.transaction(settingsVersion(snapshot), async (manager, current) => {
      await this.activation?.requireDisabled(current, manager);
      return { ...current, entity: await this.settings.save(manager, { ...current.entity,
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
        ...(baseUrl !== undefined ? { apiBaseUrl: baseUrl } : {}),
      }),
      };
    });
    return this.response(updated);
  }


  // A separate Director-confirmed clean reconnect. Removes only Syrve bindings and
  // their dependent Syrve observation history; never changes physical tables.
  async resetBindings(dto: ResetSyrveBindingsDto, actor?: AuthUser) {
    if (actor?.role !== 'owner' || typeof actor.sub !== 'string' || !actor.sub
      || !Number.isSafeInteger(actor.directorSessionVersion)) {
      throw new ForbiddenException('Підтвердіть постійний вхід Директора перед скиданням зв’язків.');
    }
    const before = await this.checkedRevision(dto);
    const result = await this.settings.transaction(settingsVersion(before), async (manager, current) => {
      await this.activation.requireDisabled(current, manager);
      const entity = current.entity;
      if (!entity || !current.links.length || current.links.length !== dto.expectedLinks
        || current.links.some(link => link.integrationId !== entity.id)) {
        throw new ConflictException('Кількість або склад зв’язків змінилися. Оновіть сторінку перед скиданням.');
      }
      const table = (name: string) => this.settings.table(name);
      // Do not delete a link while an older Syrve worker still owns its lease.
      const [worker] = await manager.query('SELECT lease_until > clock_timestamp() AS busy FROM '
        + table('syrve_worker_state') + ' WHERE integration_id=$1 FOR UPDATE', [entity.id]);
      if (worker?.busy) throw new ConflictException('Каса ще перевіряється. Дочекайтеся завершення та повторіть скидання.');
      const [activation] = await manager.query('SELECT enabled, configuration_revision FROM ' + table('syrve_sync_activation')
        + ' WHERE integration_id=$1 FOR UPDATE', [entity.id]);
      // A previous disconnect rotates the configuration revision without changing
      // the old activation row. Only a matching, currently enabled scope blocks reset.
      if (activation?.enabled && activation.configuration_revision === entity.configurationRevision) {
        throw new ConflictException('Спочатку вимкніть автоматичні статуси Syrve.');
      }

      // FK cascades retire only Syrve sync states and order versions for these links.
      // The entire reset, including credential revocation, is one transaction.
      const deleted = await manager.query('DELETE FROM ' + table('syrve_table_links')
        + ' WHERE integration_id=$1 RETURNING id', [entity.id]);
      if (deleted.length !== current.links.length) throw staleSyrveSettings();
      const next = await this.settings.save(manager, { ...entity,
        apiLoginEncrypted: null, apiLoginIv: null, apiLoginAuthTag: null, apiLoginMasked: null,
        organizationId: null, organizationName: null, status: 'not_connected',
        lastCheckedAt: new Date(), connectedAt: null, lastError: null });
      await manager.query('UPDATE ' + table('syrve_sync_activation')
        + ' SET enabled=false,configuration_revision=$2,bindings_fingerprint=NULL,loading_plan=NULL,'
        + 'actor_hash=NULL,consented_at=NULL WHERE integration_id=$1', [entity.id, next.configurationRevision]);
      return { removedLinks: deleted.length,
        integration: this.response({ prepared: true, entity: next, links: [] }) };
    });
    await this.audit('Директор скинув зв’язки Syrve для чистого перепідключення', {
      removedLinks: result.removedLinks, actorName: actor.name || null, actorRole: actor.role });
    return { message: 'Зв’язки та історію станів Syrve скинуто. Підключіть API заново.', ...result };
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
