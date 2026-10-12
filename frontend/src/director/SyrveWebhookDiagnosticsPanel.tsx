import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveWebhookDiagnostics, type SyrveWebhookSetup } from '../api/syrve';
import { syrveOperationError } from './services/syrveOperationErrors';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FAILURE = 'Перевірку сповіщень не завершено. Оновіть підключення та повторіть перевірку.';
const SETUP_FAILURE = 'Підключення сповіщень не підтверджено. Оновіть підключення та повторіть перевірку.';
type Scope = { configurationRevision: string; organizationId: string };

export function validateWebhookDiagnostics(value: unknown, expected: Scope): SyrveWebhookDiagnostics {
  const report = value as SyrveWebhookDiagnostics;
  if (!report || typeof report !== 'object' || typeof report.configurationRevision !== 'string'
    || !UUID.test(report.configurationRevision) || report.configurationRevision !== expected.configurationRevision
    || typeof report.organizationId !== 'string' || !UUID.test(report.organizationId)
    || report.organizationId !== expected.organizationId.toLowerCase()
    || typeof report.startedAt !== 'string' || typeof report.checkedAt !== 'string'
    || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.checkedAt))
    || Date.parse(report.checkedAt) < Date.parse(report.startedAt)
    || report.settingsReadAccess !== 'confirmed' || report.settingsWriteAccess !== 'not_checked'
    || typeof report.webhookAddressSet !== 'boolean' || typeof report.authorizationSet !== 'boolean'
    || report.settingsChanged !== false || report.statusesApplied !== false) throw new Error(FAILURE);
  const verification = report.verification;
  if (verification !== undefined && (!verification || typeof verification !== 'object' || Array.isArray(verification)
    || [verification.addressMatches, verification.authorizationMatches, verification.tableFilterPresent,
      verification.orderStatusesMatch, verification.itemStatusesMatch].some(value => typeof value !== 'boolean'))) throw new Error(FAILURE);
  return {
    configurationRevision: report.configurationRevision, organizationId: report.organizationId,
    startedAt: report.startedAt, checkedAt: report.checkedAt,
    settingsReadAccess: 'confirmed', settingsWriteAccess: 'not_checked',
    webhookAddressSet: report.webhookAddressSet, authorizationSet: report.authorizationSet,
    settingsChanged: false, statusesApplied: false,
    ...(verification ? { verification: {
      addressMatches: verification.addressMatches, authorizationMatches: verification.authorizationMatches,
      tableFilterPresent: verification.tableFilterPresent, orderStatusesMatch: verification.orderStatusesMatch,
      itemStatusesMatch: verification.itemStatusesMatch,
    } } : {}),
  };
}

export function SyrveWebhookDiagnosticsView({ report }: { report: SyrveWebhookDiagnostics }) {
  const verification = report.verification;
  return <div className="mt-4 space-y-3 text-sm">
    <p className="font-bold text-emerald-100">Читання налаштувань сповіщень дозволено.</p>
    <p className="text-white/70">Адреса сповіщень: {report.webhookAddressSet ? 'задана' : 'не задана'}.</p>
    <p className="text-white/70">Захисний токен сповіщень: {report.authorizationSet ? 'заданий' : 'не заданий'}.</p>
    {verification && <>
      <p className="text-white/70">{!verification.addressMatches ? 'Адреса не відповідає поточному підключенню MOLO.'
        : !verification.authorizationMatches ? 'Захист сповіщень не відповідає поточному підключенню MOLO.'
        : 'Адреса й захист відповідають поточному підключенню MOLO.'}</p>
      <p className="text-white/70">{!verification.tableFilterPresent ? 'Syrve не повернув фільтр сповіщень про рахунки на столах.'
        : !verification.orderStatusesMatch ? 'Syrve не підтвердив сповіщення про відкриття, передчек, закриття та видалення рахунку.'
        : !verification.itemStatusesMatch ? 'Syrve повернув обмеження за позиціями рахунку. Надсилання всіх потрібних змін не підтверджено.'
        : 'Фільтр потрібних змін рахунку підтверджено в Syrve.'}</p>
    </>}
    <p className="text-white/55">Право змінювати налаштування окремо не перевірено. Задана адреса ще не підтверджує доставку сповіщень у MOLO.</p>
    <p className="text-xs text-white/45">Перевірено: {new Date(report.checkedAt).toLocaleString('uk-UA')}</p>
  </div>;
}

export function validateWebhookSetup(value: unknown, expected: Scope): SyrveWebhookSetup {
  const report = value as SyrveWebhookSetup;
  if (!report || typeof report !== 'object' || report.configurationRevision !== expected.configurationRevision
    || !UUID.test(report.configurationRevision) || report.organizationId !== expected.organizationId.toLowerCase()
    || !UUID.test(report.organizationId) || typeof report.startedAt !== 'string' || typeof report.checkedAt !== 'string'
    || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.checkedAt))
    || Date.parse(report.checkedAt) < Date.parse(report.startedAt) || report.settingsReadAccess !== 'confirmed'
    || !['confirmed', 'not_checked'].includes(report.settingsWriteAccess) || report.notificationsConfigured !== true
    || typeof report.settingsChanged !== 'boolean' || (report.settingsChanged && report.settingsWriteAccess !== 'confirmed')
    || report.statusesApplied !== false || report.deliveryVerified !== false) throw new Error(SETUP_FAILURE);
  return { configurationRevision: report.configurationRevision, organizationId: report.organizationId,
    startedAt: report.startedAt, checkedAt: report.checkedAt, settingsReadAccess: 'confirmed',
    settingsWriteAccess: report.settingsWriteAccess, notificationsConfigured: true, settingsChanged: report.settingsChanged,
    statusesApplied: false, deliveryVerified: false };
}

export function SyrveWebhookSetupView({ report }: { report: SyrveWebhookSetup }) {
  return <div className="mt-4 space-y-3 text-sm">
    <p className="font-bold text-emerald-100">{report.settingsChanged
      ? 'Сповіщення для MOLO налаштовано та перевірено в Syrve.' : 'Налаштування сповіщень для MOLO вже актуальні.'}</p>
    <p className="text-white/70">Доставку ще потрібно перевірити на касі: відкрити рахунок, перенести його на інший стіл і закрити.</p>
    <p className="text-xs text-white/45">Перевірено: {new Date(report.checkedAt).toLocaleString('uk-UA')}</p>
  </div>;
}

type Props = Scope & { connectionReady: boolean; busy: boolean; syncEnabled?: boolean };
export default function SyrveWebhookDiagnosticsPanel({ configurationRevision, organizationId, connectionReady, busy, syncEnabled }: Props) {
  const [report, setReport] = useState<SyrveWebhookDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupReport, setSetupReport] = useState<SyrveWebhookSetup | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const request = useRef({ version: 0, pending: false });
  const eligible = connectionReady && !busy && UUID.test(configurationRevision) && UUID.test(organizationId);
  useEffect(() => {
    request.current.version++; request.current.pending = false;
    setReport(null); setLoading(false); setError(null); setSetupReport(null); setSettingUp(false);
    return () => { request.current.version++; request.current.pending = false; };
  }, [configurationRevision, organizationId, connectionReady, busy, syncEnabled]);

  async function check() {
    if (!eligible || request.current.pending) return;
    const version = ++request.current.version;
    request.current.pending = true; setReport(null); setSetupReport(null); setSettingUp(false); setError(null); setLoading(true);
    try {
      const result = await syrveApi.webhookDiagnostics(configurationRevision);
      if (version !== request.current.version) return;
      setReport(validateWebhookDiagnostics(result, { configurationRevision, organizationId }));
    } catch (cause) {
      if (version === request.current.version) {
        const message = syrveOperationError(cause, FAILURE);
        setError(message === 'Syrve повернув неочікувану відповідь. Синхронізацію не ввімкнено.'
          ? 'Syrve повернув неповну або неочікувану відповідь. Перевірку не завершено.' : message);
      }
    } finally {
      if (version === request.current.version) { request.current.pending = false; setLoading(false); }
    }
  }
  async function setup() {
    if (!eligible || !syncEnabled || request.current.pending) return;
    const version = ++request.current.version;
    request.current.pending = true; setReport(null); setSetupReport(null); setError(null); setSettingUp(true); setLoading(true);
    try {
      const result = await syrveApi.configureWebhook(configurationRevision);
      if (version !== request.current.version) return;
      setSetupReport(validateWebhookSetup(result, { configurationRevision, organizationId }));
    } catch (cause) {
      if (version === request.current.version) setError(syrveOperationError(cause, SETUP_FAILURE));
    } finally {
      if (version === request.current.version) { request.current.pending = false; setLoading(false); setSettingUp(false); }
    }
  }
  const displayed = eligible && report?.configurationRevision === configurationRevision
    && report.organizationId === organizationId.toLowerCase();
  const setupDisplayed = eligible && syncEnabled && setupReport?.configurationRevision === configurationRevision
    && setupReport.organizationId === organizationId.toLowerCase();
  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5" aria-label="Перевірка сповіщень Syrve">
    <h2 className="font-black">Сповіщення Syrve</h2>
    <p className="mt-2 text-sm text-white/55">Перевірте доступ збереженого API-ключа до налаштувань сповіщень. Ця перевірка лише читає дані.</p>
    <button type="button" disabled={!eligible || loading} onClick={() => void check()}
      className="mt-3 rounded-xl border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">Перевірити доступ до сповіщень</button>
    <p className="mt-4 text-sm text-white/55">Підключіть надсилання змін рахунків із Syrve у MOLO. API-ключ і захисний токен залишаються на сервері.</p>
    <button type="button" disabled={!eligible || !syncEnabled || loading} onClick={() => void setup()}
      className="mt-3 rounded-xl border border-emerald-200/35 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100 disabled:opacity-40">Підключити сповіщення для MOLO</button>
    {eligible && !syncEnabled && <p className="mt-3 text-sm text-white/55">Спочатку ввімкніть автостатуси Syrve.</p>}
    {!eligible && <p className="mt-3 text-sm text-white/55">{busy ? 'Дочекайтеся завершення поточної дії.' : 'Спочатку збережіть і перевірте підключення Syrve.'}</p>}
    {loading && <p className="mt-3 text-sm" role="status">{settingUp ? 'Підключаємо сповіщення для MOLO…' : 'Перевіряємо доступ до налаштувань сповіщень…'}</p>}
    {error && <p className="mt-3 text-sm text-amber-100" role="alert">{error}</p>}
    {displayed && report && <SyrveWebhookDiagnosticsView report={report} />}
    {setupDisplayed && setupReport && <SyrveWebhookSetupView report={setupReport} />}
  </section>;
}
