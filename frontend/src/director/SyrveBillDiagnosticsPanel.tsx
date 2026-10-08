import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveBillDiagnostics } from '../api/syrve';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Scope = { configurationRevision: string; organizationId: string; requestedId: string };
function invalid(): never { throw new Error('Недійсний результат перевірки рахунку.'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function validateBillDiagnostics(value: unknown, expected: Scope): SyrveBillDiagnostics {
  const report = value as SyrveBillDiagnostics;
  if (!report || typeof report !== 'object' || !uuid(report.configurationRevision)
    || report.configurationRevision !== expected.configurationRevision
    || !uuid(report.organizationId) || report.organizationId !== expected.organizationId.toLowerCase()
    || !uuid(report.requestedId) || report.requestedId !== expected.requestedId.toLowerCase()
    || typeof report.startedAt !== 'string' || typeof report.checkedAt !== 'string'
    || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.checkedAt))
    || Date.parse(report.checkedAt) < Date.parse(report.startedAt)
    || report.statusesApplied !== false || report.bindingsApplied !== false
    || typeof report.found !== 'boolean') invalid();
  const order = report.order;
  if (!report.found) {
    if (order !== null || report.lookup !== null) invalid();
  } else {
    if (!order || !uuid(order.id) || (order.posId !== null && !uuid(order.posId))
      || !Number.isSafeInteger(order.timestamp) || order.timestamp < 0
      || !['Success', 'InProgress', 'Error'].includes(order.creationStatus)
      || !['posId', 'orderId'].includes(report.lookup || '')
      || (report.lookup === 'orderId' ? order.id !== report.requestedId
        : order.posId !== null ? order.posId !== report.requestedId : order.id !== report.requestedId)
      || !Array.isArray(order.tables) || order.tables.length > 1000
      || new Set(order.tables.map(table => table?.syrveTableId)).size !== order.tables.length
      || order.tables.some(table => !table || !uuid(table.syrveTableId)
        || (table.moloTableNumber !== null && (typeof table.moloTableNumber !== 'string'
          || !table.moloTableNumber || table.moloTableNumber.length > 40)))) invalid();
    if (order.creationStatus === 'Success') {
      if (order.number === null || !Number.isInteger(order.number) || order.number < 0 || order.number > 2147483647
        || !['New', 'Bill', 'Closed', 'Deleted', 'Unknown'].includes(order.status || '')
        || !uuid(order.terminalGroupId)) invalid();
    } else if (order.number !== null || order.status !== null || order.terminalGroupId !== null || order.tables.length) invalid();
  }
  // Keep only diagnostic identity fields; never retain items, guests or raw POS bodies.
  return { configurationRevision: report.configurationRevision, organizationId: report.organizationId,
    requestedId: report.requestedId, startedAt: report.startedAt, checkedAt: report.checkedAt,
    lookup: report.lookup, found: report.found, statusesApplied: false, bindingsApplied: false,
    order: order ? { id: order.id, posId: order.posId, timestamp: order.timestamp,
      creationStatus: order.creationStatus, number: order.number, status: order.status,
      terminalGroupId: order.terminalGroupId,
      tables: order.tables.map(({ syrveTableId, moloTableNumber }) => ({ syrveTableId, moloTableNumber })) } : null };
}

const STATUS = { New: 'Відкритий', Bill: 'Рахунок до оплати', Closed: 'Закритий', Deleted: 'Видалений', Unknown: 'Невідомий стан' };
export function SyrveBillDiagnosticsView({ report }: { report: SyrveBillDiagnostics }) {
  const order = report.order;
  return <div className="mt-4 space-y-3 text-sm" role="status">
    <p className="text-xs text-white/45">Перевірено: {new Date(report.checkedAt).toLocaleString('uk-UA')}</p>
    {!order ? <p className="text-amber-100">Рахунок не знайдено в обраному підключенні Syrve. Це не підтверджує закриття рахунку.</p>
      : <>
        <p className="font-bold">{order.number === null ? 'Рахунок знайдено' : `Рахунок №${order.number}`} · {order.status ? STATUS[order.status]
          : order.creationStatus === 'InProgress' ? 'Ще обробляється Syrve' : 'Syrve повідомив про помилку рахунку'}</p>
        <dl className="space-y-2 rounded-2xl border border-white/10 p-3">
          <div><dt className="text-white/50">UUID рахунку в Syrve Cloud</dt><dd className="break-all font-mono text-xs">{order.id}</dd></div>
          <div><dt className="text-white/50">UUID рахунку в касі</dt><dd className="break-all font-mono text-xs">{order.posId || 'Syrve не надав UUID'}</dd></div>
          {order.terminalGroupId && <div><dt className="text-white/50">UUID касової групи</dt><dd className="break-all font-mono text-xs">{order.terminalGroupId}</dd></div>}
        </dl>
        <ul className="space-y-2">{order.tables.map(table => <li key={table.syrveTableId} className="rounded-xl border border-white/10 p-3">
          <p>{table.moloTableNumber ? `Пов’язаний стіл MOLO: ${table.moloTableNumber}` : 'Цей UUID стола не має однозначного зв’язку в MOLO'}</p>
          <p className="mt-1 break-all font-mono text-xs text-white/55">{table.syrveTableId}</p>
        </li>)}</ul>
        {!order.tables.length && <p className="text-white/55">Syrve не надав столів цього рахунку.</p>}
      </>}
    <p className="text-white/55">Статуси столів та зв’язки не змінено.</p>
  </div>;
}

type Props = { configurationRevision: string | null; organizationId: string | null; connectionReady: boolean; busy: boolean };
export default function SyrveBillDiagnosticsPanel({ configurationRevision, organizationId, connectionReady, busy }: Props) {
  const [input, setInput] = useState('');
  const [report, setReport] = useState<SyrveBillDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef({ version: 0, pending: false });
  const requestedId = input.trim().toLowerCase();
  const ready = connectionReady && !busy && uuid(configurationRevision) && uuid(organizationId);
  const eligible = ready && uuid(requestedId);
  useEffect(() => {
    request.current.version++; request.current.pending = false;
    setReport(null); setLoading(false); setFailed(false);
    return () => { request.current.version++; request.current.pending = false; };
  }, [configurationRevision, organizationId, connectionReady, busy, requestedId]);
  async function checkBill() {
    if (!eligible || request.current.pending || !configurationRevision || !organizationId) return;
    const version = ++request.current.version;
    request.current.pending = true; setReport(null); setFailed(false); setLoading(true);
    try {
      const value = await syrveApi.billDiagnostics(configurationRevision, requestedId);
      if (version !== request.current.version) return;
      setReport(validateBillDiagnostics(value, { configurationRevision, organizationId, requestedId }));
    } catch { if (version === request.current.version) setFailed(true); }
    finally { if (version === request.current.version) { request.current.pending = false; setLoading(false); } }
  }
  const displayed = eligible && report?.configurationRevision === configurationRevision
    && report.organizationId === organizationId?.toLowerCase() && report.requestedId === requestedId;
  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5" aria-label="Перевірка окремого рахунку Syrve">
    <h2 className="font-black">Перевірка окремого рахунку</h2>
    <p className="mt-2 text-sm text-white/55">Знайдіть рахунок за UUID, щоб перевірити, до яких столів його прив’язано у Syrve.</p>
    <label className="mt-3 block text-sm">UUID рахунку
      <input value={input} onChange={event => setInput(event.target.value)} disabled={!ready || loading}
        autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={38}
        className="mt-2 block w-full rounded-xl border border-white/15 bg-black/30 p-3 font-mono text-xs" />
    </label>
    <button type="button" disabled={!eligible || loading} onClick={() => void checkBill()}
      className="mt-3 rounded-xl border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">Перевірити рахунок</button>
    {!ready && <p className="mt-3 text-sm text-white/55">{busy ? 'Дочекайтеся завершення поточної дії.' : 'Спочатку збережіть і перевірте підключення Syrve.'}</p>}
    {loading && <p className="mt-3 text-sm" role="status">Перевіряємо рахунок… Через ліміт запитів Syrve це може тривати кілька хвилин.</p>}
    {failed && <p className="mt-3 text-sm text-amber-100" role="alert">Перевірку не завершено або налаштування змінилися. Оновіть підключення та повторіть перевірку.</p>}
    {displayed && report && <SyrveBillDiagnosticsView report={report} />}
  </section>;
}
