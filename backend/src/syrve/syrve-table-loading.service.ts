import { syrveObservationDeadline, withSyrveLease } from './syrve-operation-context';
import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ConfirmSyrveTableLoadingDto, SyrveRevisionDto } from './dto/syrve-integration.dto';
import { SyrveClient, SyrveClientException, type SyrveProbeControls } from './syrve-client';
import { decryptSyrveCredentials, syrveCredentialsKey } from './syrve-credentials';
import { issueLoadingProof, loadingActor, loadingPlanFingerprint, tableLoadingPlan, verifyLoadingProof } from './syrve-table-loading';
import { SyrveTableLoadingStore, type TableLoadingCapture } from './syrve-table-loading.store';

const FLAGS = { syncEnabled: false, activationAvailable: false, statusesApplied: false, renamingApplied: false, complete: false } as const;
@Injectable()
export class SyrveTableLoadingService {
  constructor(private readonly store: SyrveTableLoadingStore, private readonly client: SyrveClient) {}
  private identity(actor?: AuthUser) {
    try { return loadingActor(actor); }
    catch { throw new ConflictException('Сесію Директора не підтверджено. Увійдіть повторно перед перевіркою столів.'); }
  }
  async probePlan(captured: TableLoadingCapture, controls: SyrveProbeControls = {}) {
    const { entity, links } = captured.snapshot;
    const knownIds = [...new Set(links.flatMap(link => link.activeSyrveOrderIds))];
    const probe = await this.client.probeOrders(entity!.apiBaseUrl, decryptSyrveCredentials(entity!), entity!.organizationId!,
      links.map(link => link.syrveTableId), knownIds, controls);
    await this.store.assertCurrent(captured);
    for (const check of Object.values(probe.checks)) {
      if (check.status === 'error') throw new SyrveClientException(check.code as ConstructorParameters<typeof SyrveClientException>[0]);
    }
    if (probe.organizationId !== entity!.organizationId!.toLowerCase()
      || knownIds.length && probe.checks.ordersById.status !== 'ok') throw new SyrveClientException('SYRVE_INVALID_RESPONSE');
    try { return tableLoadingPlan(probe, links.map(link => link.syrveTableId)); }
    catch { throw new ConflictException('Для всіх пов’язаних столів потрібні доступні каси Syrve POS від версії 7.7.1 та дозволи читання. Перевірте підключення.'); }
  }
  async preview(dto: SyrveRevisionDto, actor?: AuthUser) {
    const identity = this.identity(actor), key = syrveCredentialsKey();
    const captured = await this.store.capture(dto.configurationRevision), plan = await this.probePlan(captured);
    const tableNumbers = captured.snapshot.links.map(link => captured.tables.find(table => table.id === link.moloTableId)!.tableNumber).sort();
    const checkedAt = Date.now();
    return { configurationRevision: dto.configurationRevision, organizationId: plan.organizationId,
      checkedAt: new Date(checkedAt).toISOString(), linkedTables: tableNumbers.length, terminalGroups: plan.groups.length, tableNumbers,
      confirmation: issueLoadingProof(key, { revision: dto.configurationRevision, local: captured.fingerprint,
        upstream: loadingPlanFingerprint(plan), actor: identity }, checkedAt), ...FLAGS };
  }
  async load(dto: ConfirmSyrveTableLoadingDto, actor?: AuthUser) {
    // Reject forged/stale/different-session proofs before decrypting credentials.
    const identity = this.identity(actor);
    let proof: ReturnType<typeof verifyLoadingProof>;
    try { proof = verifyLoadingProof(syrveCredentialsKey(), dto.confirmationProof); }
    catch { throw new ConflictException('Підтвердження завантаження недійсне або прострочене. Повторіть перевірку столів.'); }
    if (dto.confirmed !== true || proof.actor !== identity || proof.revision !== dto.configurationRevision) throw new ConflictException('Повторіть перевірку та підтвердження завантаження столів.');
    const captured = await this.store.capture(dto.configurationRevision);
    if (captured.fingerprint !== proof.local) throw new ConflictException('Налаштування або столи змінилися. Повторіть перевірку.');
    const controls = { deadline: syrveObservationDeadline(), requestBudget: { remaining: 25 } };
    const plan = await this.probePlan(captured, controls);
    if (loadingPlanFingerprint(plan) !== proof.upstream || proof.expires <= Date.now()) throw new ConflictException('Склад столів або кас змінився. Повторіть перевірку.');
    // Reserve authentication, one synchronous load per group, and the complete
    // post-load read. Never consume the one-use proof when even the shortest
    // successful path exceeds the remaining shared request/time budget.
    const known = new Set(captured.snapshot.links.flatMap(link => link.activeSyrveOrderIds)).size;
    if (Date.now() >= controls.deadline) throw new SyrveClientException('SYRVE_TIMEOUT');
    if (controls.requestBudget.remaining < 2 + plan.groups.length + 6 + Math.ceil(known / 200)) throw new SyrveClientException('SYRVE_OBSERVATION_LIMIT');
    const lease = await this.store.claim(captured), entity = lease.snapshot.entity!;
    let commandsConfirmed = false, readCompleted = false, code: string | null = null;
    try {
      await withSyrveLease(() => this.store.renew(lease), () => this.store.guard(lease), async () => {
        await this.client.initializeTables(entity.apiBaseUrl, decryptSyrveCredentials(entity), plan,
          { ...controls, beforeCommand: () => this.store.guard(lease) });
        commandsConfirmed = true;
        const after = await this.probePlan(lease, controls);
        if (loadingPlanFingerprint(after) !== proof.upstream) throw new ConflictException('Склад столів змінився під час завантаження.');
        await this.store.guard(lease);
        if (Date.now() >= controls.deadline) throw new SyrveClientException('SYRVE_TIMEOUT');
        readCompleted = true;
        await this.store.release(lease);
      });
    } catch (error) {
      code = error instanceof SyrveClientException ? (error.getResponse() as { code: string }).code
        : error instanceof ConflictException ? 'SYRVE_CONFIGURATION_CHANGED' : 'SYRVE_UNAVAILABLE';
      // Unknown completion keeps the bounded lease until expiry. No automatic
      // retry, initialization receipt, worker success or positive state write.
      readCompleted = false;
    }
    return { requestedRevision: dto.configurationRevision, configurationRevision: entity.configurationRevision,
      organizationId: plan.organizationId, checkedAt: new Date().toISOString(), linkedTables: captured.snapshot.links.length,
      terminalGroups: plan.groups.length, completedGroups: commandsConfirmed ? plan.groups.length : 0,
      commandsConfirmed, readCompleted, code, ...FLAGS };
  }
}
