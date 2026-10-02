import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveOrderCheckKey, type SyrveOrderDiagnostics } from '../api/syrve';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LABELS: Record<SyrveOrderCheckKey, string> = {
  connection: 'Доступ до ресторану', terminalGroups: 'Касові групи', restaurantSections: 'Столи ресторану',
  posAvailability: 'Доступність кас', ordersByTable: 'Замовлення за столами', ordersById: 'Раніше відомі замовлення',
};
const ERROR_MESSAGES: Record<string, string> = {
  SYRVE_AUTH_FAILED: 'Перевірте API-ключ і збережене підключення.',
  SYRVE_ACCESS_DENIED: 'Syrve не надав потрібного дозволу для цієї перевірки.',
  SYRVE_RATE_LIMITED: 'Syrve обмежив запити. Повторіть перевірку пізніше.',
  SYRVE_TIMEOUT: 'Каса не відповіла вчасно. Повторіть перевірку пізніше.',
  SYRVE_UNAVAILABLE: 'Захищене з’єднання із Syrve недоступне.',
  SYRVE_INVALID_RESPONSE: 'Отримані дані неповні або некоректні. Потрібна додаткова перевірка.',
  SYRVE_NO_ORGANIZATIONS: 'У доступі Syrve немає активного ресторану.',
  SYRVE_ORGANIZATION_UNAVAILABLE: 'Обраний ресторан більше не доступний у Syrve.',
  SYRVE_OBSERVATION_LIMIT: 'Перевірку зупинено на безпечному ліміті. Потрібна перевірка обсягу даних.',
};
const COUNTS = ['linkedTables', 'tablesWithOpenOrders', 'unknownTables', 'observedOrders', 'openOrders',
  'explicitlyClosedOrders', 'unknownOrders', 'unresolvedKnownOrders'] as const;
const GROUPS = ['alive', 'sleeping', 'offline', 'unknown'] as const;
type Scope = { configurationRevision: string; organizationId: string; linkedTables: number };
function invalid(): never { throw new Error('Недійсний результат перевірки замовлень.'); }
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function validateOrderDiagnostics(value: unknown, expected: Scope): SyrveOrderDiagnostics {
  const report = value as SyrveOrderDiagnostics;
  if (!report || typeof report !== 'object' || report.configurationRevision !== expected.configurationRevision
    || !UUID.test(report.configurationRevision) || !UUID.test(report.organizationId)
    || report.organizationId !== expected.organizationId.toLowerCase()
    || typeof report.startedAt !== 'string' || typeof report.checkedAt !== 'string'
    || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.checkedAt))
    || Date.parse(report.checkedAt) < Date.parse(report.startedAt)
    || report.syncEnabled !== false || report.activationAvailable !== false
    || report.statusesApplied !== false || report.renamingApplied !== false
    || report.diagnostics?.complete !== false || report.diagnostics.posOrderVisibility !== 'not_verified'
    || report.diagnostics.posVersion !== 'not_verified' || report.diagnostics.initializationPerformed !== false
    || !Array.isArray(report.checks) || report.checks.length !== Object.keys(LABELS).length
    || new Set(report.checks.map(check => check?.key)).size !== report.checks.length
    || report.checks.some(check => !check || !Object.prototype.hasOwnProperty.call(LABELS, check.key)
      || !['ok', 'error', 'not_checked'].includes(check.status)
      || (check.status === 'error' ? typeof check.code !== 'string' || !Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, check.code) : check.code !== null))) invalid();
  const summary = report.summary;
  if (!summary || typeof summary !== 'object' || !summary.terminalGroups
    || COUNTS.some(key => !count(summary[key])) || GROUPS.some(key => !count(summary.terminalGroups[key]))
    || summary.linkedTables !== expected.linkedTables
    || summary.tablesWithOpenOrders + summary.unknownTables !== summary.linkedTables
    || summary.openOrders + summary.explicitlyClosedOrders + summary.unknownOrders !== summary.observedOrders) invalid();
  const required = report.checks.filter(check => check.key !== 'ordersById');
  if ((required.some(check => check.status !== 'ok') || report.checks.some(check => check.key === 'ordersById' && check.status === 'error'))
    && (summary.openOrders || summary.explicitlyClosedOrders || summary.tablesWithOpenOrders)) invalid();
  // Retain only the bounded public contract; arbitrary response fields and
  // driver/upstream messages must never become displayed or retained evidence.
  return {
    configurationRevision: report.configurationRevision, organizationId: report.organizationId,
    startedAt: report.startedAt, checkedAt: report.checkedAt,
    checks: report.checks.map(({ key, status, code }) => ({ key, status, code })),
    summary: { linkedTables: summary.linkedTables, tablesWithOpenOrders: summary.tablesWithOpenOrders,
      unknownTables: summary.unknownTables, observedOrders: summary.observedOrders, openOrders: summary.openOrders,
      explicitlyClosedOrders: summary.explicitlyClosedOrders, unknownOrders: summary.unknownOrders,
      unresolvedKnownOrders: summary.unresolvedKnownOrders,
      terminalGroups: { alive: summary.terminalGroups.alive, sleeping: summary.terminalGroups.sleeping,
        offline: summary.terminalGroups.offline, unknown: summary.terminalGroups.unknown } },
    diagnostics: { complete: false, posOrderVisibility: 'not_verified', posVersion: 'not_verified', initializationPerformed: false },
    syncEnabled: false, activationAvailable: false, statusesApplied: false, renamingApplied: false,
  };
}

export function SyrveOrderDiagnosticsView({ report }: { report: SyrveOrderDiagnostics }) {
  return <div className="mt-4 space-y-4">
    <p className="text-xs text-white/45">Перевірено: {new Date(report.checkedAt).toLocaleString('uk-UA')}</p>
    <ul className="space-y-3">{report.checks.map(check => <li key={check.key} className="text-sm">
      <p className="font-bold text-white/85">{LABELS[check.key]} · {check.status === 'ok' ? 'доступ підтверджено' : check.status === 'error' ? 'перевірку не пройдено' : 'ще не перевірено'}</p>
      {check.status === 'error' && <p className="mt-1 text-amber-100">{ERROR_MESSAGES[check.code!]}</p>}
    </li>)}</ul>
    <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 p-3 text-sm">
      <div><dt className="text-white/50">Перевірено зв’язків столів</dt><dd className="font-bold">{report.summary.linkedTables}</dd></div>
      <div><dt className="text-white/50">Столи з невідомим станом</dt><dd className="font-bold">{report.summary.unknownTables}</dd></div>
      <div><dt className="text-white/50">Побачено відкритих замовлень</dt><dd className="font-bold">{report.summary.openOrders}</dd></div>
      <div><dt className="text-white/50">Явно закриті замовлення</dt><dd className="font-bold">{report.summary.explicitlyClosedOrders}</dd></div>
      <div><dt className="text-white/50">Раніше відомі замовлення без підтвердження</dt><dd className="font-bold">{report.summary.unresolvedKnownOrders}</dd></div>
      <div><dt className="text-white/50">Доступні касові групи</dt><dd className="font-bold">{report.summary.terminalGroups.alive}</dd></div>
    </dl>
    {(report.summary.terminalGroups.sleeping > 0 || report.summary.terminalGroups.offline > 0 || report.summary.terminalGroups.unknown > 0)
      && <p className="text-sm text-amber-100">Сплячі касові групи: {report.summary.terminalGroups.sleeping}. Недоступні: {report.summary.terminalGroups.offline}. Без підтвердження доступності: {report.summary.terminalGroups.unknown}.</p>}
    <p className="text-sm text-white/55">Порожня відповідь або зникнення замовлення не означає, що стіл вільний. Закриття окремого замовлення не підтверджує вільний стіл.</p>
    <p className="text-sm text-amber-100">Повноту даних і версію каси ще не підтверджено. Синхронізація залишається вимкненою.</p>
  </div>;
}

type Props = { configurationRevision: string | null; organizationId: string | null;
  linkedTables: number; connectionReady: boolean; busy: boolean };
export default function SyrveOrderDiagnosticsPanel(props: Props) {
  const { configurationRevision, organizationId, linkedTables, connectionReady, busy } = props;
  const [report, setReport] = useState<SyrveOrderDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef({ version: 0, pending: false });
  const eligible = connectionReady && !busy && linkedTables > 0 && count(linkedTables)
    && UUID.test(configurationRevision || '') && UUID.test(organizationId || '');
  useEffect(() => {
    request.current.version++; request.current.pending = false;
    setReport(null); setLoading(false); setFailed(false);
    return () => { request.current.version++; request.current.pending = false; };
  }, [configurationRevision, organizationId, linkedTables, connectionReady, busy]);
  async function checkOrders() {
    if (!eligible || request.current.pending || !configurationRevision || !organizationId) return;
    const version = ++request.current.version;
    request.current.pending = true;
    setReport(null); setFailed(false); setLoading(true);
    try {
      const value = await syrveApi.orderDiagnostics(configurationRevision);
      if (version !== request.current.version) return;
      setReport(validateOrderDiagnostics(value, { configurationRevision, organizationId, linkedTables }));
    } catch {
      if (version === request.current.version) setFailed(true);
    } finally {
      if (version === request.current.version) { request.current.pending = false; setLoading(false); }
    }
  }
  const displayed = eligible && report?.configurationRevision === configurationRevision
    && report.organizationId === organizationId?.toLowerCase() && report.summary.linkedTables === linkedTables;
  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5" aria-label="Перевірка замовлень Syrve">
    <h2 className="font-black">Замовлення та доступність кас</h2>
    <p className="mt-2 text-sm text-white/55">Одноразова перевірка підтверджених столів. Бронювання, ручні статуси та збережені дані залишаються без змін.</p>
    <button type="button" disabled={!eligible || loading} onClick={() => void checkOrders()}
      className="mt-3 rounded-xl border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">Перевірити замовлення та каси</button>
    {!eligible && <p className="mt-3 text-sm text-white/55">{busy ? 'Дочекайтеся завершення поточної дії.' : 'Спочатку збережіть і перевірте підключення та підтвердьте зв’язки столів.'}</p>}
    {loading && <p className="mt-3 text-sm" role="status">Перевіряємо доступ до замовлень і кас…</p>}
    {failed && <p className="mt-3 text-sm text-amber-100" role="alert">Перевірку не завершено або налаштування змінилися. Оновіть підключення та повторіть перевірку.</p>}
    {displayed && report && <SyrveOrderDiagnosticsView report={report} />}
  </section>;
}
