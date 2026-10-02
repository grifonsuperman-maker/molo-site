import { useEffect, useState } from 'react';
import { syrveApi, type SyrveReadiness } from '../api/syrve';

const LABELS: Record<string, string> = { schema: 'Підготовка бази', connection: 'Збережене підключення',
  mapping: 'Зв’язки столів', state: 'Збережений стан столів', orders: 'Читання стану столів',
  visibility: 'Повнота даних каси', activation: 'Увімкнення синхронізації' };
const MESSAGES: Record<string, string> = {
  SCHEMA_VERIFIED: 'Структуру бази та історію підготовки підтверджено.',
  SCHEMA_PENDING: 'Підготовку бази потрібно завершити за перевіреним планом.',
  SCHEMA_REQUIRES_AUDIT: 'Підготовка бази потребує окремої перевірки.',
  CONNECTION_SAVED: 'Доступ до обраного ресторану збережено.',
  CONNECTION_REQUIRED: 'Збережіть і перевірте підключення до ресторану.',
  MAPPING_VALID: 'Збережені зв’язки відповідають існуючим столам MOLO.',
  MAPPING_REQUIRED: 'Підтвердьте коректні зв’язки столів після підготовки бази.',
  STATE_VALID: 'Збережений стан столів пройшов перевірку.',
  STATE_UNOBSERVED: 'Стани столів ще не перевірялися автоматично.',
  STATE_REQUIRES_AUDIT: 'Збережений стан потребує перевірки без зміни столів.',
  ORDER_ACCESS_NOT_CHECKED: 'Права на читання стану столів перевіряються окремо після підключення.',
  POS_VISIBILITY_NOT_VERIFIED: 'Повноту даних каси ще не підтверджено. Відсутність даних не означає, що стіл вільний.',
  ACTIVATION_NOT_AVAILABLE: 'Увімкнення стане доступним після завершення підготовки та перевірок.',
  ACTIVATION_AVAILABLE: 'Можна підготувати та підтвердити автоматичні статуси. Перевірка сама їх не вмикає.',
  ACTIVATION_ENABLED: 'Автоматичні статуси дозволено Директором. Кожне оновлення окремо перевіряє доступність і повноту даних каси.',
};
const CODES: Record<string, readonly string[]> = { schema: ['SCHEMA_VERIFIED','SCHEMA_PENDING','SCHEMA_REQUIRES_AUDIT'],
  connection: ['CONNECTION_SAVED','CONNECTION_REQUIRED'], mapping: ['MAPPING_VALID','MAPPING_REQUIRED'],
  state: ['STATE_VALID','STATE_UNOBSERVED','STATE_REQUIRES_AUDIT'], orders: ['ORDER_ACCESS_NOT_CHECKED'],
  visibility: ['POS_VISIBILITY_NOT_VERIFIED'], activation: ['ACTIVATION_NOT_AVAILABLE','ACTIVATION_AVAILABLE','ACTIVATION_ENABLED'] };
const SUCCESS_CODES = ['SCHEMA_VERIFIED','CONNECTION_SAVED','MAPPING_VALID','STATE_VALID','ACTIVATION_AVAILABLE','ACTIVATION_ENABLED'];
const UNCHECKED_CODES = ['STATE_UNOBSERVED','ORDER_ACCESS_NOT_CHECKED','POS_VISIBILITY_NOT_VERIFIED'];

export function validateReadiness(value: SyrveReadiness): SyrveReadiness {
  if (!value || typeof value.syncEnabled !== 'boolean' || typeof value.activationAvailable !== 'boolean'
    || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))
    || (value.configurationRevision !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.configurationRevision))
    || !Array.isArray(value.checks) || value.checks.length !== Object.keys(LABELS).length
    || new Set(value.checks.map(check => check?.key)).size !== value.checks.length
    || value.checks.some(check => !check || !CODES[check.key]?.includes(check.code)
      || check.status !== (SUCCESS_CODES.includes(check.code) ? 'ok' : UNCHECKED_CODES.includes(check.code) ? 'not_checked' : 'blocked'))) {
    throw new Error('Недійсний результат перевірки готовності.');
  }
  const activation = value.checks.find(check => check.key === 'activation')!;
  if (activation.code !== (value.syncEnabled ? 'ACTIVATION_ENABLED' : value.activationAvailable ? 'ACTIVATION_AVAILABLE' : 'ACTIVATION_NOT_AVAILABLE')) throw new Error('Недійсний стан автостатусів.');
  return value;
}

export function SyrveReadinessView({ report }: { report: SyrveReadiness }) {
  return <ul className="mt-3 space-y-3">{report.checks.map(check => <li key={check.key} className="text-sm">
    <p className="font-bold text-white/85">{LABELS[check.key]} · {check.status === 'ok' ? 'підтверджено' : check.status === 'blocked' ? 'потребує підготовки' : 'ще не перевірено'}</p>
    <p className="mt-1 text-white/55">{MESSAGES[check.code]}</p>
  </li>)}</ul>;
}

export default function SyrveReadinessPanel({ configurationRevision }: { configurationRevision: string | null }) {
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<SyrveReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true); setReport(null); setFailed(false);
    void syrveApi.getReadiness().then(value => {
      if (!current) return;
      const checked = validateReadiness(value);
      if (checked.configurationRevision !== configurationRevision) throw new Error('Налаштування змінилися.');
      setReport(checked);
    }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [configurationRevision, refresh]);
  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5" aria-label="Готовність Syrve">
    <div className="flex items-center justify-between gap-3"><h2 className="font-black">Готовність синхронізації</h2>
      <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold disabled:opacity-40">Оновити перевірку</button></div>
    <p className="mt-2 text-sm text-white/55">Перевірка збереженого підключення. Увімкнення потребує окремого підтвердження Директора.</p>
    {loading && <p className="mt-3 text-sm" role="status">Перевіряємо готовність…</p>}
    {failed && <p className="mt-3 text-sm text-amber-100" role="alert">Перевірку не завершено або налаштування змінилися. Оновіть сторінку та повторіть перевірку.</p>}
    {report && report.configurationRevision === configurationRevision && <SyrveReadinessView report={report} />}
  </section>;
}
