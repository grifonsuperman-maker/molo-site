import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveTableLoadingPreview, type SyrveTableLoadingResult } from '../api/syrve';
import { syrveOperationError } from './services/syrveOperationErrors';

const FAILURE_MESSAGE = 'Завантаження не підтверджено або налаштування змінилися. Оновіть підключення перед новою спробою.';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown) => typeof value === 'string' && value.length === 36 && UUID.test(value);
const ERROR_CODES = ['SYRVE_AUTH_FAILED', 'SYRVE_ACCESS_DENIED', 'SYRVE_RATE_LIMITED', 'SYRVE_TIMEOUT',
  'SYRVE_UNAVAILABLE', 'SYRVE_INVALID_RESPONSE', 'SYRVE_NO_ORGANIZATIONS', 'SYRVE_ORGANIZATION_UNAVAILABLE',
  'SYRVE_OBSERVATION_LIMIT', 'SYRVE_COMMAND_FAILED', 'SYRVE_COMMAND_IN_PROGRESS', 'SYRVE_COMMAND_EXPIRED', 'SYRVE_CONFIGURATION_CHANGED'];
type Scope = { configurationRevision: string; organizationId: string; linkedTables: number };
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function invalid(): never { throw new Error('Недійсний результат завантаження столів.'); }
function checked(value: SyrveTableLoadingPreview | SyrveTableLoadingResult, scope: Scope) {
  if (!value || typeof value !== 'object' || value.organizationId !== scope.organizationId.toLowerCase()
    || !uuid(value.configurationRevision) || !uuid(value.organizationId)
    || value.linkedTables !== scope.linkedTables || !count(value.linkedTables) || value.linkedTables < 1 || value.linkedTables > 100
    || !count(value.terminalGroups) || value.terminalGroups < 1 || value.terminalGroups > 4 || value.terminalGroups > value.linkedTables
    || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))
    || ['syncEnabled', 'activationAvailable', 'statusesApplied', 'renamingApplied', 'complete']
      .some(key => value[key as keyof typeof value] !== false)) invalid();
}
export function validateLoadingPreview(value: unknown, scope: Scope, now = Date.now()): SyrveTableLoadingPreview {
  const preview = value as SyrveTableLoadingPreview; checked(preview, scope);
  const confirmation = preview.confirmation;
  if (preview.configurationRevision !== scope.configurationRevision || !Array.isArray(preview.tableNumbers)
    || preview.tableNumbers.length !== scope.linkedTables || new Set(preview.tableNumbers).size !== scope.linkedTables
    || preview.tableNumbers.some(number => typeof number !== 'string' || number !== number.trim() || !/^[1-9]\d{0,5}$/.test(number))
    || !confirmation || typeof confirmation.proof !== 'string' || confirmation.proof.length > 1500
    || !/^[\w-]{40,}\.[\w-]{43}$/.test(confirmation.proof) || typeof confirmation.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(confirmation.expiresAt)) || Date.parse(confirmation.expiresAt) <= now
    || Date.parse(confirmation.expiresAt) > now + 5 * 60_000) invalid();
  return { configurationRevision: preview.configurationRevision, organizationId: preview.organizationId, checkedAt: preview.checkedAt,
    linkedTables: preview.linkedTables, terminalGroups: preview.terminalGroups, tableNumbers: [...preview.tableNumbers],
    confirmation: { proof: confirmation.proof, expiresAt: confirmation.expiresAt },
    syncEnabled: false, activationAvailable: false, statusesApplied: false, renamingApplied: false, complete: false };
}
export function validateLoadingResult(value: unknown, scope: Scope, groups: number): SyrveTableLoadingResult {
  const result = value as SyrveTableLoadingResult; checked(result, scope);
  if (result.requestedRevision !== scope.configurationRevision || result.configurationRevision === scope.configurationRevision
    || result.terminalGroups !== groups || !count(result.completedGroups)
    || typeof result.commandsConfirmed !== 'boolean' || typeof result.readCompleted !== 'boolean'
    || result.completedGroups !== (result.commandsConfirmed ? groups : 0)
    || result.readCompleted && !result.commandsConfirmed
    || (result.readCompleted ? result.code !== null : !ERROR_CODES.includes(result.code || ''))) invalid();
  return { requestedRevision: result.requestedRevision, configurationRevision: result.configurationRevision,
    organizationId: result.organizationId, checkedAt: result.checkedAt, linkedTables: result.linkedTables, terminalGroups: result.terminalGroups,
    completedGroups: result.completedGroups, commandsConfirmed: result.commandsConfirmed, readCompleted: result.readCompleted, code: result.code,
    syncEnabled: false, activationAvailable: false, statusesApplied: false, renamingApplied: false, complete: false };
}
type Props = { configurationRevision: string | null; organizationId: string | null; linkedTables: number;
  connectionReady: boolean; busy: boolean; onBusyChange?: (busy: boolean) => void;
  onFinished?: (result: SyrveTableLoadingResult | null, failureReason?: string) => Promise<void> };

export default function SyrveTableLoadingPanel(props: Props) {
  const [preview, setPreview] = useState<SyrveTableLoadingPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<SyrveTableLoadingResult | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const request = useRef({ version: 0, pending: false });
  const { configurationRevision, organizationId, linkedTables, connectionReady, busy } = props;
  const eligible = connectionReady && !busy && count(linkedTables) && linkedTables > 0 && linkedTables <= 100
    && uuid(configurationRevision) && uuid(organizationId);
  useEffect(() => {
    request.current.version++; request.current.pending = false;
    setPreview(null); setAcknowledged(false); setLoading(false); setFailed(false); setResult(null); setFailureReason(null);
    return () => { request.current.version++; request.current.pending = false; props.onBusyChange?.(false); };
  }, [configurationRevision, organizationId, linkedTables, connectionReady, busy]);
  async function prepare() {
    if (!eligible || request.current.pending || !configurationRevision || !organizationId) return;
    const version = ++request.current.version;
    request.current.pending = true; setPreview(null); setAcknowledged(false); setResult(null); setFailed(false); setLoading(true); setFailureReason(null);
    props.onBusyChange?.(true);
    try {
      const value = await syrveApi.previewTableLoading(configurationRevision);
      if (version === request.current.version) setPreview(validateLoadingPreview(value, { configurationRevision, organizationId, linkedTables }));
    } catch (cause) {
      if (version === request.current.version) { setFailed(true); setFailureReason(syrveOperationError(cause, FAILURE_MESSAGE)); }
    }
    finally {
      if (version === request.current.version) { request.current.pending = false; setLoading(false); props.onBusyChange?.(false); }
    }
  }
  async function confirm() {
    if (!eligible || request.current.pending || !acknowledged || !preview || !configurationRevision || !organizationId) return;
    if (preview.configurationRevision !== configurationRevision || Date.parse(preview.confirmation.expiresAt) <= Date.now()) {
      setPreview(null); setAcknowledged(false); setFailed(true);
      setFailureReason(preview.configurationRevision !== configurationRevision
        ? 'Налаштування або столи змінилися. Повторіть перевірку перед підтвердженням.'
        : 'Підтвердження завантаження прострочене. Повторіть підготовку завантаження.'); return;
    }
    const version = ++request.current.version, scope = { configurationRevision, organizationId, linkedTables };
    request.current.pending = true; setLoading(true); setPreview(null); setAcknowledged(false); setResult(null); setFailed(false); setFailureReason(null);
    props.onBusyChange?.(true);
    let validated: SyrveTableLoadingResult | null = null;
    let operationFailureReason: string | undefined;
    try {
      const value = await syrveApi.loadTables(configurationRevision, preview.confirmation.proof);
      if (version !== request.current.version) return;
      validated = validateLoadingResult(value, scope, preview.terminalGroups); setResult(validated);
    } catch (cause) {
      operationFailureReason = syrveOperationError(cause, FAILURE_MESSAGE);
      if (version === request.current.version) { setFailed(true); setFailureReason(operationFailureReason); }
    }
    finally {
      if (version === request.current.version) {
        // The server consumes this revision before sending commands. Refresh
        // saved settings after failures too; an old proof can never be retried.
        try { await props.onFinished?.(validated, operationFailureReason); } catch (cause) {
          if (version === request.current.version) { setFailed(true); setFailureReason(previous => previous || syrveOperationError(cause, FAILURE_MESSAGE)); }
        }
        if (version === request.current.version) { request.current.pending = false; setLoading(false); props.onBusyChange?.(false); }
      }
    }
  }
  const visible = eligible && preview?.configurationRevision === configurationRevision && preview.organizationId === organizationId?.toLowerCase();
  const resultVisible = eligible && result?.requestedRevision === configurationRevision
    && result.organizationId === organizationId?.toLowerCase() && result.linkedTables === linkedTables;
  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5" aria-label="Завантаження стану столів Syrve">
    <h2 className="font-black">Завантаження стану столів із каси</h2>
    <p className="mt-2 text-sm text-white/55">Syrve завантажить дані лише для підтверджених столів. Спочатку перевірте перелік, потім підтвердьте дію.</p>
    <p className="mt-2 text-sm text-white/55">Потрібні доступні каси Syrve POS від версії 7.7.1 та дозволи на завантаження даних і перевірку завершення.</p>
    <button type="button" disabled={!eligible || loading} onClick={() => void prepare()}
      className="mt-3 rounded-xl border border-cyan-200/35 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">Підготувати завантаження</button>
    {visible && preview && <div className="mt-4 space-y-3">
      <p className="text-sm">Столи: {preview.tableNumbers.join(', ')}. Касових груп: {preview.terminalGroups}.</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={acknowledged}
        onChange={event => setAcknowledged(event.target.checked)} />Підтверджую завантаження стану перелічених столів із Syrve.</label>
      <button type="button" disabled={!acknowledged || loading} onClick={() => void confirm()}
        className="rounded-xl border border-amber-200/35 px-4 py-3 text-sm font-bold text-amber-100 disabled:opacity-40">Завантажити стан столів</button>
    </div>}
    {!eligible && <p className="mt-3 text-sm text-white/55">Спочатку збережіть підключення, підтвердьте зв’язки столів та завершіть поточну дію.</p>}
    {loading && <p className="mt-3 text-sm" role="status">Перевіряємо столи та завершення операції Syrve…</p>}
    {failed && <p className="mt-3 text-sm text-amber-100" role="alert">{failureReason || FAILURE_MESSAGE}</p>}
    {resultVisible && result && <p className="mt-3 text-sm text-amber-100" role="status">{result.readCompleted
      ? 'Syrve підтвердив завершення завантаження. Повторне читання столів виконано.'
      : result.code === 'SYRVE_COMMAND_IN_PROGRESS' ? 'Syrve ще виконує завантаження. Дочекайтеся завершення перед новою перевіркою.'
        : syrveOperationError(result, 'Завершення завантаження та повторне читання не підтверджено.')}</p>}
    <p className="mt-3 text-sm text-white/55">Статуси на карті ще не застосовуються. Порожня відповідь не підтверджує вільний стіл. Синхронізація залишається вимкненою.</p>
  </section>;
}
