import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveAutoStatus, type SyrveActivationPreview, type SyrveActivationResult } from '../api/syrve';

type Scope = { configurationRevision: string | null; organizationId: string | null; linkedTables: number };
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const time = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const codes = ['SYRVE_AUTH_FAILED','SYRVE_ACCESS_DENIED','SYRVE_RATE_LIMITED','SYRVE_TIMEOUT','SYRVE_UNAVAILABLE','SYRVE_INVALID_RESPONSE',
  'SYRVE_ORGANIZATION_UNAVAILABLE','SYRVE_OBSERVATION_LIMIT','SYRVE_COMMAND_FAILED','SYRVE_COMMAND_IN_PROGRESS','SYRVE_COMMAND_EXPIRED','SYRVE_CONFIGURATION_CHANGED'];
export function validateAutoStatus(value: SyrveAutoStatus, scope: Scope): SyrveAutoStatus {
  if (!value || value.configurationRevision !== scope.configurationRevision || !time(value.checkedAt)
    || typeof value.syncEnabled !== 'boolean' || typeof value.activationAvailable !== 'boolean' || value.linkedTables !== scope.linkedTables
    || !Number.isSafeInteger(value.linkedTables) || value.linkedTables < 0 || value.linkedTables > 100
    || (value.configurationRevision !== null && !uuid(value.configurationRevision))
    || ((value.syncEnabled || value.activationAvailable) && (!uuid(value.configurationRevision) || !value.linkedTables))) throw new Error('Недійсний стан автостатусів.');
  return { configurationRevision: value.configurationRevision, checkedAt: value.checkedAt, syncEnabled: value.syncEnabled, activationAvailable: value.activationAvailable, linkedTables: value.linkedTables };
}
export function validateActivationPreview(value: SyrveActivationPreview, scope: Scope): SyrveActivationPreview {
  if (!value || !uuid(scope.configurationRevision) || value.configurationRevision !== scope.configurationRevision || value.organizationId !== scope.organizationId
    || !uuid(value.organizationId) || !time(value.checkedAt) || value.syncEnabled !== false || value.linkedTables !== scope.linkedTables
    || !Number.isSafeInteger(value.linkedTables) || value.linkedTables < 1 || value.linkedTables > 100
    || !Number.isSafeInteger(value.terminalGroups) || value.terminalGroups < 1 || value.terminalGroups > 4
    || !Array.isArray(value.tableNumbers) || value.tableNumbers.length !== value.linkedTables || new Set(value.tableNumbers).size !== value.tableNumbers.length
    || value.tableNumbers.some(number => typeof number !== 'string' || !/^[1-9]\d{0,5}$/.test(number))
    || !value.confirmation || typeof value.confirmation.proof !== 'string' || value.confirmation.proof.length > 1500
    || !/^[\w-]{40,}\.[\w-]{43}$/.test(value.confirmation.proof) || !time(value.confirmation.expiresAt)
    || Date.parse(value.confirmation.expiresAt) <= Date.now() || Date.parse(value.confirmation.expiresAt) > Date.now() + 300000) throw new Error('Недійсна перевірка автостатусів.');
  return { configurationRevision: value.configurationRevision, organizationId: value.organizationId, checkedAt: value.checkedAt, syncEnabled: false,
    linkedTables: value.linkedTables, terminalGroups: value.terminalGroups, tableNumbers: [...value.tableNumbers],
    confirmation: { proof: value.confirmation.proof, expiresAt: value.confirmation.expiresAt } };
}
export function validateActivationResult(value: SyrveActivationResult, scope: Scope): SyrveActivationResult {
  if (!value || value.requestedRevision !== scope.configurationRevision || !uuid(value.configurationRevision) || value.configurationRevision === scope.configurationRevision
    || value.organizationId !== scope.organizationId || value.linkedTables !== scope.linkedTables || !time(value.checkedAt)
    || typeof value.syncEnabled !== 'boolean' || (value.syncEnabled ? value.code !== null : !codes.includes(value.code || ''))) throw new Error('Недійсний результат увімкнення.');
  return { requestedRevision: value.requestedRevision, configurationRevision: value.configurationRevision, organizationId: value.organizationId,
    linkedTables: value.linkedTables, checkedAt: value.checkedAt, syncEnabled: value.syncEnabled, code: value.code };
}

type Props = Scope & { syncEnabled: boolean; busy: boolean; onBusyChange: (busy: boolean) => void; onFinished: (result: 'enabled' | 'disabled' | 'failed') => Promise<void> };
export default function SyrveAutoStatusPanel(props: Props) {
  const [gate, setGate] = useState<SyrveAutoStatus | null>(null), [preview, setPreview] = useState<SyrveActivationPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [working, setWorking] = useState(false), [failed, setFailed] = useState(false);
  const version = useRef(0), pending = useRef(false);
  useEffect(() => {
    const current = ++version.current;
    setGate(null); setPreview(null); setAcknowledged(false); setFailed(false); setWorking(false); pending.current = false;
    if (!props.busy) void syrveApi.getAutoStatus().then(value => {
      if (version.current !== current) return;
      const checked = validateAutoStatus(value, props);
      if (checked.syncEnabled !== props.syncEnabled) throw new Error('Налаштування змінилися.');
      setGate(checked);
    }).catch(() => { if (version.current === current) setFailed(true); });
    return () => { version.current++; };
  }, [props.configurationRevision, props.organizationId, props.linkedTables, props.syncEnabled, props.busy]);
  const allowed = !props.busy && !pending.current && uuid(props.configurationRevision) && uuid(props.organizationId);
  async function prepare() {
    if (!allowed || !gate?.activationAvailable || gate.syncEnabled) return;
    const current = version.current; pending.current = true; setWorking(true); setFailed(false); setPreview(null); setAcknowledged(false); props.onBusyChange(true);
    try {
      const checked = validateActivationPreview(await syrveApi.previewAutoStatus(props.configurationRevision!), props);
      if (version.current === current) setPreview(checked);
    } catch { if (version.current === current) setFailed(true); }
    finally { if (version.current === current) { pending.current = false; setWorking(false); props.onBusyChange(false); } }
  }
  async function change(enable: boolean) {
    if (!allowed || !gate || (enable ? !preview || !acknowledged || gate.syncEnabled : !gate.syncEnabled)) return;
    if (enable && Date.parse(preview!.confirmation.expiresAt) <= Date.now()) { setPreview(null); setAcknowledged(false); setFailed(true); return; }
    const current = version.current, proof = preview?.confirmation.proof;
    let outcome: 'enabled' | 'disabled' | 'failed' = 'failed';
    pending.current = true; setWorking(true); setPreview(null); setAcknowledged(false); setFailed(false); props.onBusyChange(true);
    try {
      if (enable) {
        const result = validateActivationResult(await syrveApi.enableAutoStatus(props.configurationRevision!, proof!), props);
        if (result.syncEnabled) outcome = 'enabled';
        if (version.current === current && !result.syncEnabled) setFailed(true);
      } else {
        const result = await syrveApi.disableAutoStatus(props.configurationRevision!);
        if (!result || result.syncEnabled !== false || !uuid(result.configurationRevision) || result.configurationRevision === props.configurationRevision || !time(result.checkedAt)) throw new Error('Недійсний результат вимкнення.');
        outcome = 'disabled';
      }
    } catch { if (version.current === current) setFailed(true); }
    finally {
      if (version.current === current) {
        // Refresh the consumed revision after success, failure or transport loss.
        try { await props.onFinished(outcome); } catch { if (version.current === current) setFailed(true); } finally {
          if (version.current === current) { pending.current = false; setWorking(false); props.onBusyChange(false); }
        }
      }
    }
  }
  return <section className="mt-5 rounded-[28px] border border-emerald-200/25 bg-neutral-950/80 p-4 sm:p-5" aria-label="Автоматичні статуси столів">
    <h2 className="font-black">Автоматичні статуси столів</h2>
    <p className="mt-2 text-sm text-white/60">{props.syncEnabled ? 'Увімкнено Директором. Новий відкритий рахунок позначає стіл зайнятим. Закриття підтверджується лише після повного читання каси.' : 'Для увімкнення перевірте столи та підтвердьте регулярне завантаження їхнього стану із Syrve.'}</p>
    <p className="mt-2 text-xs text-white/50">Ручні дії офіціанта мають захист від запізнілих відповідей каси. Бронювання та майбутні дати зберігають свої правила.</p>
    {props.syncEnabled && <p className="mt-2 text-xs text-white/50">Якщо каса недоступна або відповідь неповна, остання підтверджена зайнятість зберігається.</p>}
    {working && <p className="mt-3 text-sm" role="status">Перевіряємо та оновлюємо налаштування…</p>}
    {failed && <p className="mt-3 text-sm text-amber-100" role="alert">Операцію не підтверджено або налаштування змінилися. Оновіть підключення та повторіть перевірку.</p>}
    {gate && !gate.activationAvailable && !gate.syncEnabled && <p className="mt-3 text-sm text-amber-100">Спочатку потрібно завершити підготовку бази, зберегти підключення та підтвердити зв’язки столів.</p>}
    {!props.syncEnabled && <button type="button" disabled={!allowed || working || !gate?.activationAvailable} onClick={() => void prepare()} className="mt-4 rounded-2xl border border-cyan-200/35 px-4 py-3 text-sm font-bold disabled:opacity-40">Перевірити перед увімкненням</button>}
    {preview && <div className="mt-4 rounded-2xl border border-amber-200/25 p-4 text-sm">
      <p>Столи: {preview.tableNumbers.join(', ')}. Касових груп: {preview.terminalGroups}.</p>
      <label className="mt-3 flex gap-3"><input type="checkbox" checked={acknowledged} disabled={working} onChange={event => setAcknowledged(event.target.checked)} />
        <span>Дозволяю серверу регулярно завантажувати стан цих столів із Syrve та автоматично оновлювати їхню зайнятість.</span></label>
      <button type="button" disabled={!allowed || working || !acknowledged} onClick={() => void change(true)} className="mt-4 rounded-2xl border border-emerald-200/40 px-4 py-3 font-bold disabled:opacity-40">Увімкнути автостатуси</button>
    </div>}
    {props.syncEnabled && <><p className="mt-3 text-xs text-white/50">Після вимкнення карта використовуватиме ручні статуси та бронювання.</p>
      <button type="button" disabled={!allowed || working || !gate?.syncEnabled} onClick={() => void change(false)} className="mt-4 rounded-2xl border border-amber-200/35 px-4 py-3 text-sm font-bold disabled:opacity-40">Вимкнути автостатуси</button></>}
  </section>;
}
