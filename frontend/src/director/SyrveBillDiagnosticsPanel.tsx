import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveBillDiagnostics, type SyrveBillRegisters, type SyrvePosVersionStatus } from '../api/syrve';
import { syrveOperationError } from './services/syrveOperationErrors';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Scope = { configurationRevision: string; organizationId: string; requestedId: string; terminalGroupId?: string };
function invalid(): never { throw new Error('Недійсний результат перевірки рахунку.'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const VERSION_MESSAGES: Record<SyrvePosVersionStatus, string> = {
  valid: 'Версію каси отримано від Syrve.',
  missing: 'Syrve не передав поле версії каси.',
  null: 'Syrve передав порожню версію каси (null).',
  empty: 'Syrve передав порожній текст замість версії каси.',
  invalid_type: 'Syrve передав версію каси у неочікуваному типі даних.',
  invalid_format: 'Syrve передав версію каси у форматі, який MOLO не розпізнає.',
};
const FAILURE_MESSAGE = 'Перевірку не завершено або налаштування змінилися. Оновіть підключення та повторіть перевірку.';
const BILL_ERRORS = new Set([
  'Обрана касова група недоступна або її версія не підтримує завантаження рахунків.',
  'Обрана касова група зараз не відповідає. Завантаження рахунку не виконано.',
  'Підтвердіть завантаження цього рахунку з обраної касової групи.',
]);
function billError(cause: unknown): string {
  const message = cause && typeof cause === 'object' ? (cause as { message?: unknown }).message : null;
  if (typeof message === 'string' && BILL_ERRORS.has(message)) return message;
  const safe = syrveOperationError(cause, FAILURE_MESSAGE);
  return safe === 'Syrve повернув неочікувану відповідь. Синхронізацію не ввімкнено.'
    ? 'Syrve повернув неповну або неочікувану відповідь. Перевірку не завершено.' : safe;
}

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
  const posLoading = report.posLoading;
  if (expected.terminalGroupId) {
    if (!posLoading || !uuid(posLoading.terminalGroupId) || posLoading.terminalGroupId !== expected.terminalGroupId.toLowerCase()
      || typeof posLoading.terminalGroupName !== 'string' || !posLoading.terminalGroupName.trim() || posLoading.terminalGroupName.length > 240
      || !uuid(posLoading.correlationId) || posLoading.requestAccepted !== true
      || (report.lookup !== null && report.lookup !== 'posId')) invalid();
  } else if (posLoading !== undefined) invalid();
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
        || (order.sum != null && (typeof order.sum !== 'number' || !Number.isFinite(order.sum) || order.sum < 0))
        || !['New', 'Bill', 'Closed', 'Deleted', 'Unknown'].includes(order.status || '')
        || !uuid(order.terminalGroupId)) invalid();
    } else if (order.number !== null || order.sum != null || order.status !== null || order.terminalGroupId !== null || order.tables.length) invalid();
  }
  // Keep only diagnostic identity fields; never retain items, guests or raw POS bodies.
  return { configurationRevision: report.configurationRevision, organizationId: report.organizationId,
    requestedId: report.requestedId, startedAt: report.startedAt, checkedAt: report.checkedAt,
    lookup: report.lookup, found: report.found, statusesApplied: false, bindingsApplied: false,
    ...(posLoading ? { posLoading: { terminalGroupId: posLoading.terminalGroupId, terminalGroupName: posLoading.terminalGroupName,
      correlationId: posLoading.correlationId, requestAccepted: true as const } } : {}),
    order: order ? { id: order.id, posId: order.posId, timestamp: order.timestamp,
      creationStatus: order.creationStatus, number: order.number, sum: order.sum ?? null, status: order.status,
      terminalGroupId: order.terminalGroupId,
      tables: order.tables.map(({ syrveTableId, moloTableNumber }) => ({ syrveTableId, moloTableNumber })) } : null };
}

export function validateBillRegisters(value: unknown, expected: Pick<Scope, 'configurationRevision' | 'organizationId'>): SyrveBillRegisters {
  const result = value as SyrveBillRegisters;
  if (!result || typeof result !== 'object' || result.configurationRevision !== expected.configurationRevision
    || !uuid(result.configurationRevision) || result.organizationId !== expected.organizationId.toLowerCase() || !uuid(result.organizationId)
    || typeof result.checkedAt !== 'string' || !Number.isFinite(Date.parse(result.checkedAt))
    || !Array.isArray(result.registers) || result.registers.length > 100
    || new Set(result.registers.map(item => item?.id)).size !== result.registers.length
    || result.registers.some(item => !item || !uuid(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 240
      || typeof item.loadingSupported !== 'boolean' || (item.loadingSupported && item.posVersion === null)
      || (item.canAttemptLoading !== undefined && (typeof item.canAttemptLoading !== 'boolean'
        || item.canAttemptLoading && !item.loadingSupported
          && !(item.posVersion === null && (item.posVersionStatus === 'missing' || item.posVersionStatus === 'null'))))
      || (item.posVersionStatus !== undefined && (typeof item.posVersionStatus !== 'string'
        || !Object.prototype.hasOwnProperty.call(VERSION_MESSAGES, item.posVersionStatus)
        || (item.posVersionStatus === 'valid') !== (item.posVersion !== null)))
      || (item.posVersion !== null && (typeof item.posVersion !== 'string'
        || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2,3}$/.test(item.posVersion))))) invalid();
  return { configurationRevision: result.configurationRevision, organizationId: result.organizationId, checkedAt: result.checkedAt,
    registers: result.registers.map(({ id, name, posVersion, posVersionStatus, loadingSupported, canAttemptLoading }) => ({ id, name, posVersion,
      ...(posVersionStatus !== undefined ? { posVersionStatus } : {}), loadingSupported,
      ...(canAttemptLoading !== undefined ? { canAttemptLoading } : {}) })) };
}

const registerCanAttempt = (item?: SyrveBillRegisters['registers'][number]) => item?.canAttemptLoading ?? item?.loadingSupported ?? false;

export function SyrveBillRegistersView({ report }: { report: SyrveBillRegisters }) {
  return <div className="mt-3 space-y-2 text-sm">
    <p className="text-xs text-white/45">Перевірено: {new Date(report.checkedAt).toLocaleString('uk-UA')}</p>
    <ul className="space-y-2" aria-label="Версії касових груп">{report.registers.map(item => <li key={item.id}
      className="rounded-xl border border-white/10 p-3">
      <p className="font-bold">{item.name}</p>
      <p className="mt-1">Версія каси: {item.posVersion || 'невідома'}</p>
      <p className="mt-1 text-white/55">{item.posVersionStatus ? VERSION_MESSAGES[item.posVersionStatus]
        : item.posVersion ? VERSION_MESSAGES.valid
          : 'Причину невідомої версії не отримано. Потрібна повторна перевірка після оновлення MOLO.'}</p>
      {item.posVersion && <p className="mt-1 text-white/55">{item.loadingSupported
        ? 'Версія підтримує завантаження рахунків.' : 'Для завантаження рахунків потрібна версія каси від 7.7.1.'}</p>}
      {!item.posVersion && registerCanAttempt(item) && <p className="mt-1 text-amber-100">Можна підтвердити пробне завантаження цього рахунку. Підтримку методу ще не підтверджено.</p>}
    </li>)}</ul>
    {!report.registers.length && <p className="text-amber-100">Syrve не надав активних касових груп.</p>}
  </div>;
}

const STATUS = { New: 'Відкритий', Bill: 'Рахунок до оплати', Closed: 'Закритий', Deleted: 'Видалений', Unknown: 'Невідомий стан' };
export function SyrveBillDiagnosticsView({ report }: { report: SyrveBillDiagnostics }) {
  const order = report.order;
  return <div className="mt-4 space-y-3 text-sm" role="status">
    <p className="text-xs text-white/45">Перевірено: {new Date(report.checkedAt).toLocaleString('uk-UA')}</p>
    {report.posLoading && <div className="rounded-2xl border border-cyan-200/20 p-3">
      <p>Syrve прийняв запит завантаження рахунку з касової групи «{report.posLoading.terminalGroupName}».</p>
      <p className="mt-1 break-all font-mono text-xs text-white/55">{report.posLoading.terminalGroupId}</p>
      <p className="mt-2 text-white/55">Порівняйте номер і суму рахунку з касою. Прийняття запиту ще не підтверджує правильність UUID або стан стола.</p>
      {order?.terminalGroupId && order.terminalGroupId !== report.posLoading.terminalGroupId
        && <p className="mt-2 text-amber-100">Касова група у відповіді відрізняється від обраної для завантаження.</p>}
    </div>}
    {!order ? <p className="text-amber-100">Рахунок не знайдено в обраному підключенні Syrve. Це не підтверджує закриття рахунку.</p>
      : <>
        <p className="font-bold">{order.number === null ? 'Рахунок знайдено' : `Рахунок №${order.number}`} · {order.status ? STATUS[order.status]
          : order.creationStatus === 'InProgress' ? 'Ще обробляється Syrve' : 'Syrve повідомив про помилку рахунку'}</p>
        {order.sum != null && <p>Сума рахунку: {order.sum.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
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
  const [registers, setRegisters] = useState<SyrveBillRegisters | null>(null);
  const [terminalGroupId, setTerminalGroupId] = useState('');
  const [confirmationScope, setConfirmationScope] = useState<string | null>(null);
  const [action, setAction] = useState<'read' | 'registers' | 'pos'>('read');
  const [failureMessage, setFailureMessage] = useState('');
  const request = useRef<{ version: number; pending: boolean; scope?: string }>({ version: 0, pending: false });
  const confirmation = useRef<string | null>(null);
  const requestedId = input.trim().toLowerCase();
  const ready = connectionReady && !busy && uuid(configurationRevision) && uuid(organizationId);
  const eligible = ready && uuid(requestedId);
  useEffect(() => {
    request.current.version++; request.current.pending = false;
    setReport(null); setLoading(false); setFailed(false); setFailureMessage(''); clearConfirmation();
    const scope = JSON.stringify([configurationRevision, organizationId, connectionReady, busy]);
    if (request.current.scope !== scope) {
      request.current.scope = scope; setRegisters(null); setTerminalGroupId('');
    }
    return () => { request.current.version++; request.current.pending = false; };
  }, [configurationRevision, organizationId, connectionReady, busy, requestedId, terminalGroupId]);
  const currentRegisters = ready && registers?.configurationRevision === configurationRevision
    && registers.organizationId === organizationId?.toLowerCase() ? registers : null;
  const selected = currentRegisters?.registers.find(item => item.id === terminalGroupId);
  const posScope = eligible && registerCanAttempt(selected)
    ? JSON.stringify([configurationRevision, organizationId?.toLowerCase(), requestedId, terminalGroupId]) : null;
  const confirmed = posScope !== null && confirmationScope === posScope;
  function clearConfirmation() { confirmation.current = null; setConfirmationScope(null); }
  async function checkBill(kind: 'read' | 'registers' | 'pos' = 'read') {
    if (!(kind === 'registers' ? ready : eligible) || request.current.pending || !configurationRevision || !organizationId) return;
    if (kind === 'pos' && (!confirmed || confirmation.current !== posScope || !registerCanAttempt(selected))) return;
    const version = ++request.current.version;
    request.current.pending = true; setReport(null); setFailed(false); setFailureMessage(''); setLoading(true); setAction(kind); clearConfirmation();
    try {
      if (kind === 'registers') {
        const value = await syrveApi.billRegisters(configurationRevision);
        if (version !== request.current.version) return;
        const checked = validateBillRegisters(value, { configurationRevision, organizationId });
        const available = checked.registers.filter(registerCanAttempt);
        setRegisters(checked);
        setTerminalGroupId(available.some(item => item.id === terminalGroupId) ? terminalGroupId : available.length === 1 ? available[0].id : '');
        return;
      }
      const value = kind === 'pos'
        ? await syrveApi.posBillDiagnostics(configurationRevision, requestedId, terminalGroupId)
        : await syrveApi.billDiagnostics(configurationRevision, requestedId);
      if (version !== request.current.version) return;
      setReport(validateBillDiagnostics(value, { configurationRevision, organizationId, requestedId,
        ...(kind === 'pos' ? { terminalGroupId } : {}) }));
    } catch (cause) { if (version === request.current.version) { setFailed(true); setFailureMessage(billError(cause)); } }
    finally { if (version === request.current.version) { request.current.pending = false; setLoading(false); } }
  }
  const displayed = eligible && report?.configurationRevision === configurationRevision
    && report.organizationId === organizationId?.toLowerCase() && report.requestedId === requestedId
    && (!report.posLoading || report.posLoading.terminalGroupId === terminalGroupId);
  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5" aria-label="Перевірка окремого рахунку Syrve">
    <h2 className="font-black">Перевірка окремого рахунку</h2>
    <p className="mt-2 text-sm text-white/55">Знайдіть рахунок за UUID, щоб перевірити, до яких столів його прив’язано у Syrve.</p>
    <label className="mt-3 block text-sm">UUID рахунку
      <input value={input} onChange={event => { clearConfirmation(); setInput(event.target.value); }} disabled={!ready || loading}
        autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={38}
        className="mt-2 block w-full rounded-xl border border-white/15 bg-black/30 p-3 font-mono text-xs" />
    </label>
    <button type="button" disabled={!eligible || loading} onClick={() => void checkBill()}
      className="mt-3 rounded-xl border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">Перевірити рахунок</button>
    <div className="mt-4 rounded-2xl border border-white/10 p-3">
      <h3 className="font-bold">Перевірка через касу</h3>
      <p className="mt-2 text-sm text-white/55">Завантажте дані одного рахунку з обраної касової групи перед пошуком. UUID із QR може відрізнятися від UUID рахунку в касі.</p>
      <button type="button" disabled={!ready || loading} onClick={() => void checkBill('registers')}
        className="mt-3 rounded-xl border border-white/20 px-4 py-3 text-sm font-bold disabled:opacity-40">Обрати касу для перевірки</button>
      {currentRegisters && <>
        <SyrveBillRegistersView report={currentRegisters} />
        <label className="mt-3 block text-sm">Касова група
          <select value={terminalGroupId} onChange={event => { clearConfirmation(); setTerminalGroupId(event.target.value); }} disabled={loading}
            className="mt-2 block w-full rounded-xl border border-white/15 bg-neutral-900 p-3">
            <option value="">Оберіть касову групу</option>
            {currentRegisters.registers.map(item => <option key={item.id} value={item.id} disabled={!registerCanAttempt(item)}>
              {item.name}{!registerCanAttempt(item) ? ' · Завантаження недоступне'
                : !item.loadingSupported ? ' · Версія невідома: пробна перевірка' : ''}
            </option>)}
          </select>
        </label>
        {selected && <div className="mt-2 text-xs text-white/55">
          <p className="break-all font-mono">{selected.id}</p>
        </div>}
        {!currentRegisters.registers.some(registerCanAttempt)
          && <p className="mt-2 text-sm text-amber-100">Немає активної касової групи, доступної для пробного завантаження рахунку.</p>}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={event => {
            const scope = event.target.checked ? posScope : null;
            confirmation.current = scope; setConfirmationScope(scope);
          }} disabled={loading || !posScope} />
          Підтверджую перевірку цього UUID рахунку в обраній касовій групі.
        </label>
        <button type="button" disabled={!eligible || loading || !confirmed || !registerCanAttempt(selected)} onClick={() => void checkBill('pos')}
          className="mt-3 rounded-xl border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">Завантажити з каси та перевірити</button>
      </>}
    </div>
    {!ready && <p className="mt-3 text-sm text-white/55">{busy ? 'Дочекайтеся завершення поточної дії.' : 'Спочатку збережіть і перевірте підключення Syrve.'}</p>}
    {loading && <p className="mt-3 text-sm" role="status">{action === 'registers' ? 'Отримуємо касові групи…' : action === 'pos' ? 'Завантажуємо рахунок з каси та перевіряємо…' : 'Перевіряємо рахунок…'} Через ліміт запитів Syrve це може тривати кілька хвилин.</p>}
    {failed && <p className="mt-3 text-sm text-amber-100" role="alert">{failureMessage || FAILURE_MESSAGE}</p>}
    {displayed && report && <SyrveBillDiagnosticsView report={report} />}
  </section>;
}
