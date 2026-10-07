import { syrveObservationDeadline, withSyrveLease } from './syrve-operation-context';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth-user.type';
import { EnableSyrveAutoStatusDto, SyrveRevisionDto } from './dto/syrve-integration.dto';
import { issueActivationProof, verifyActivationProof } from './syrve-activation';
import { SyrveActivationStore, type SyrveInitialObservation } from './syrve-activation.store';
import { syrveCaptureContext } from './syrve-state.store';
import { SyrveClient, SyrveClientException } from './syrve-client';
import { decryptSyrveCredentials, syrveCredentialsKey } from './syrve-credentials';
import { SyrveSettingsStore } from './syrve-settings.store';
import { loadingActor, loadingPlanFingerprint } from './syrve-table-loading';
import { SyrveTableLoadingService } from './syrve-table-loading.service';
import { SyrveTableLoadingStore } from './syrve-table-loading.store';
import { SyrveReadinessService } from './syrve-readiness.service';

@Injectable()
export class SyrveActivationService {
  constructor(private readonly activation: SyrveActivationStore, private readonly settings: SyrveSettingsStore,
    private readonly loading: SyrveTableLoadingStore, private readonly plans: SyrveTableLoadingService, private readonly client: SyrveClient,
    private readonly readiness: SyrveReadinessService) {}
  private identity(actor?: AuthUser) {
    try { return loadingActor(actor); }
    catch { throw new ConflictException('Сесію Директора не підтверджено. Увійдіть повторно перед увімкненням автостатусів.'); }
  }
  async status() {
    const snapshot = await this.settings.read(), saved = await this.activation.read(snapshot);
    return { configurationRevision: snapshot.entity?.configurationRevision || null, checkedAt: new Date().toISOString(),
      syncEnabled: saved.enabled, activationAvailable: saved.prepared && snapshot.prepared && snapshot.entity?.status === 'connected'
        && Boolean(snapshot.entity?.apiLoginEncrypted && snapshot.entity.apiLoginIv && snapshot.entity.apiLoginAuthTag && snapshot.links.length),
      linkedTables: snapshot.links.length };
  }
  async preview(dto: SyrveRevisionDto, actor?: AuthUser) {
    const identity = this.identity(actor), key = syrveCredentialsKey();
    if (!await this.activation.prepared()) throw new ServiceUnavailableException('Підготовку автоматичних статусів у базі ще не завершено.');
    if (!(await this.readiness.read()).activationAvailable) throw new ConflictException('Спочатку завершіть перевірку бази, підключення та зв’язків столів.');
    const captured = await this.loading.capture(dto.configurationRevision);
    await this.activation.requireDisabled(captured.snapshot);
    const plan = await this.plans.probePlan(captured, {}, false);
    const checkedAt = Date.now();
    return { configurationRevision: dto.configurationRevision, organizationId: plan.organizationId, checkedAt: new Date(checkedAt).toISOString(),
      linkedTables: captured.snapshot.links.length, terminalGroups: plan.groups.length,
      totalTables: captured.tables.length,
      unlinkedTableNumbers: captured.tables.filter(table => !captured.snapshot.links.some(link => link.moloTableId === table.id))
        .map(table => table.tableNumber).sort((a, b) => Number(a) - Number(b)),
      tableNumbers: captured.snapshot.links.map(link => captured.tables.find(table => table.id === link.moloTableId)!.tableNumber).sort(),
      confirmation: issueActivationProof(key, { revision: dto.configurationRevision, local: captured.fingerprint,
        upstream: loadingPlanFingerprint(plan), actor: identity }, checkedAt), syncEnabled: false };
  }
  async enable(dto: EnableSyrveAutoStatusDto, actor?: AuthUser) {
    const identity = this.identity(actor);
    let proof: ReturnType<typeof verifyActivationProof>;
    try { proof = verifyActivationProof(syrveCredentialsKey(), dto.confirmationProof); }
    catch { throw new ConflictException('Підтвердження автостатусів недійсне або прострочене. Повторіть перевірку.'); }
    if (dto.confirmed !== true || proof.actor !== identity || proof.revision !== dto.configurationRevision) throw new ConflictException('Повторіть перевірку та підтвердження автостатусів.');
    if (!await this.activation.prepared()) throw new ServiceUnavailableException('Підготовку автоматичних статусів у базі ще не завершено.');
    if (!(await this.readiness.read()).activationAvailable) throw new ConflictException('Готовність автостатусів змінилася. Повторіть перевірку.');
    const captured = await this.loading.capture(dto.configurationRevision);
    await this.activation.requireDisabled(captured.snapshot);
    if (captured.fingerprint !== proof.local) throw new ConflictException('Налаштування або столи змінилися. Повторіть перевірку.');
    const controls = { deadline: syrveObservationDeadline(), requestBudget: { remaining: 25 } };
    const plan = await this.plans.probePlan(captured, controls, false);
    if (loadingPlanFingerprint(plan) !== proof.upstream || proof.expires <= Date.now()) throw new ConflictException('Склад столів або кас змінився. Повторіть перевірку.');
    const known = new Set(captured.snapshot.links.flatMap(link => link.activeSyrveOrderIds)).size;
    if (controls.deadline <= Date.now()) throw new SyrveClientException('SYRVE_TIMEOUT');
    if (controls.requestBudget.remaining < 2 + plan.groups.length + 6 + Math.ceil(known / 200)) throw new SyrveClientException('SYRVE_OBSERVATION_LIMIT');
    const lease = await this.loading.claim(captured), entity = lease.snapshot.entity!;
    let enabled = false, code: string | null = null;
    try {
      await withSyrveLease(() => this.loading.renew(lease), () => this.loading.guard(lease), async () => {
        let observations: SyrveInitialObservation[] | undefined;
        let after = plan;
        if (dto.reconcileOpenTables === true) {
          const captures = await this.activation.captureTables(lease);
          const probes = await this.client.probeLoadedOrderBatch(entity.apiBaseUrl, decryptSyrveCredentials(entity), plan.organizationId,
            captures.map(capture => ({ tableId: capture.state.scope.syrveTableId, orderIdBatches: capture.orderIds,
              visibilityContext: syrveCaptureContext(lease.leaseId, capture) })),
            { ...controls, loadingPlan: plan, configurationRevision: entity.configurationRevision,
              beforeCommand: () => this.loading.guard(lease) });
          if (probes.length !== captures.length || probes.some((value, index) => !value || value.length !== captures[index].orderIds.length)) {
            throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
          }
          observations = captures.map((capture, index) => ({ capture,
            batches: capture.orderIds.map((orderIds, page) => ({ orderIds, probe: probes[index]![page] })) }));
        } else {
          await this.client.initializeTables(entity.apiBaseUrl, decryptSyrveCredentials(entity), plan,
            { ...controls, beforeCommand: () => this.loading.guard(lease) });
          after = await this.plans.probePlan(lease, controls);
        }
        if (loadingPlanFingerprint(after) !== proof.upstream || proof.expires <= Date.now() || Date.now() >= controls.deadline) throw new ConflictException('Перевірка змінилася або прострочена. Повторіть підтвердження.');
        await this.loading.guard(lease);
        await this.activation.enable(lease, after, identity, observations);
        enabled = true;
        try { await this.loading.release(lease); } catch { /* Already enabled; the bounded lease will expire. */ }
      });
    } catch (error) {
      code = error instanceof SyrveClientException ? (error.getResponse() as { code: string }).code
        : error instanceof ConflictException ? 'SYRVE_CONFIGURATION_CHANGED' : 'SYRVE_UNAVAILABLE';
      // No receipt on uncertain completion. Keep the lease until expiry and
      // consume the old proof; an explicit new preview is required to retry.
    }
    return { requestedRevision: dto.configurationRevision, configurationRevision: entity.configurationRevision,
      organizationId: plan.organizationId, checkedAt: new Date().toISOString(), linkedTables: captured.snapshot.links.length, syncEnabled: enabled, code };
  }
  async disable(dto: SyrveRevisionDto, actor?: AuthUser) {
    this.identity(actor);
    const configurationRevision = await this.activation.disable(dto.configurationRevision);
    return { configurationRevision, syncEnabled: false, checkedAt: new Date().toISOString() };
  }
}
