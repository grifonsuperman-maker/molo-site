import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, History, Trash2, X } from 'lucide-react';

import { logsApi, type LogRecord } from '../api/logs';

type LogView = 'active' | 'archive';
type ChangedHandler = () => void | Promise<void>;

const LOG_PAGE_SIZE = 50;

function staffName(log: LogRecord): string {
  if (log.staff?.role === 'owner') return 'Директор';
  return log.staff?.fullName || 'Система';
}

function dateTimeLabel(value: string): string {
  return new Date(value).toLocaleString('uk-UA');
}

export function StaffActionsArchiveButton({ onChanged }: { onChanged: ChangedHandler }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<LogView>('active');
  const [activeLogs, setActiveLogs] = useState<LogRecord[]>([]);
  const [activeTotal, setActiveTotal] = useState<number | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [activeRefreshRetry, setActiveRefreshRetry] = useState(false);
  const [archivedLogs, setArchivedLogs] = useState<LogRecord[]>([]);
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null);
  const [archivePage, setArchivePage] = useState(0);
  const [archiveHasMore, setArchiveHasMore] = useState(false);
  const [archiveRefreshRetry, setArchiveRefreshRetry] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LogRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const activeRequestId = useRef(0);
  const archiveRequestId = useRef(0);

  const visibleLogs = view === 'active' ? activeLogs : archivedLogs;

  async function loadActivePage(
    page: number,
    append: boolean,
    showLoading = true,
  ) {
    const requestId = ++activeRequestId.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await logsApi.getActive({ page, limit: LOG_PAGE_SIZE });
      if (requestId !== activeRequestId.current) return;

      setActiveLogs((current) => {
        if (!append) return result.items;
        const existing = new Set(current.map((log) => log.id));
        return [...current, ...result.items.filter((log) => !existing.has(log.id))];
      });
      setActiveTotal(result.total);
      setActivePage(result.page);
      setActiveHasMore(result.hasMore);
      setActiveRefreshRetry(false);
    } catch (cause: any) {
      if (requestId === activeRequestId.current) {
        if (!append) {
          if (showLoading) {
            setActiveLogs([]);
            setActiveTotal(0);
          }
          setActivePage(0);
          setActiveHasMore(false);
          setActiveRefreshRetry(!showLoading);
        }
        setError(cause?.message || 'Не вдалося завантажити активні дії персоналу');
      }
    } finally {
      if (showLoading && requestId === activeRequestId.current) setLoading(false);
    }
  }

  async function loadArchivePage(
    page: number,
    append: boolean,
    showLoading = true,
  ) {
    const requestId = ++archiveRequestId.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await logsApi.getArchive({ page, limit: LOG_PAGE_SIZE });
      if (requestId !== archiveRequestId.current) return;

      setArchivedLogs((current) => {
        if (!append) return result.items;
        const existing = new Set(current.map((log) => log.id));
        return [...current, ...result.items.filter((log) => !existing.has(log.id))];
      });
      setArchiveTotal(result.total);
      setArchivePage(result.page);
      setArchiveHasMore(result.hasMore);
      setArchiveRefreshRetry(false);
    } catch (cause: any) {
      if (requestId === archiveRequestId.current) {
        if (!append) {
          if (showLoading) {
            setArchivedLogs([]);
            setArchiveTotal(0);
          }
          setArchivePage(0);
          setArchiveHasMore(false);
          setArchiveRefreshRetry(!showLoading);
        }
        setError(cause?.message || 'Не вдалося завантажити архів дій персоналу');
      }
    } finally {
      if (showLoading && requestId === archiveRequestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (view === 'active') {
      void loadActivePage(1, false);
    } else {
      void loadArchivePage(1, false);
    }
  }, [open, view]);

  function invalidateRequests() {
    activeRequestId.current += 1;
    archiveRequestId.current += 1;
    setLoading(false);
  }

  function openManager() {
    invalidateRequests();
    setLoading(true);
    setOpen(true);
    setView('active');
    setActiveLogs([]);
    setActiveTotal(null);
    setActivePage(0);
    setActiveHasMore(false);
    setActiveRefreshRetry(false);
    setArchivedLogs([]);
    setArchiveTotal(null);
    setArchivePage(0);
    setArchiveHasMore(false);
    setArchiveRefreshRetry(false);
    setDeleteTarget(null);
    setDeleteError(null);
    setError(null);
  }

  function closeManager() {
    if (busy) return;
    invalidateRequests();
    setOpen(false);
  }

  function changeView(next: LogView) {
    if (busy || next === view) return;
    invalidateRequests();
    setLoading(true);
    setView(next);
    setError(null);
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function archiveLog(log: LogRecord) {
    setBusy(`archive:${log.id}`);
    setError(null);
    try {
      await logsApi.archive(log.id);
      setActiveLogs((current) => current.filter((item) => item.id !== log.id));
      setActiveTotal((current) => current === null ? null : Math.max(0, current - 1));
      setArchiveTotal((current) => current === null ? null : current + 1);
      await onChanged();
      await loadActivePage(1, false, false);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося архівувати дію персоналу');
    } finally {
      setBusy(null);
    }
  }

  function requestPermanentDelete(log: LogRecord) {
    setDeleteTarget(log);
    setDeleteError(null);
  }

  function cancelPermanentDelete() {
    if (busy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function deleteLogPermanently() {
    if (!deleteTarget) return;
    const log = deleteTarget;
    setBusy(`delete:${log.id}`);
    setDeleteError(null);
    try {
      await logsApi.deletePermanently(log.id);
      setArchivedLogs((current) => current.filter((item) => item.id !== log.id));
      setArchiveTotal((current) => current === null ? null : Math.max(0, current - 1));
      setDeleteTarget(null);
      await onChanged();
      await loadArchivePage(1, false, false);
    } catch (cause: any) {
      setDeleteError(cause?.message || 'Не вдалося видалити дію персоналу назавжди');
    } finally {
      setBusy(null);
    }
  }

  async function retryActiveRefresh() {
    if (busy) return;
    setBusy('active-retry');
    try {
      await loadActivePage(1, false, false);
    } finally {
      setBusy(null);
    }
  }

  async function retryArchiveRefresh() {
    if (busy) return;
    setBusy('archive-retry');
    try {
      await loadArchivePage(1, false, false);
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreActive() {
    if (!activeHasMore || activeRefreshRetry || busy) return;
    setBusy('active-page');
    try {
      await loadActivePage(activePage + 1, true, false);
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreArchive() {
    if (!archiveHasMore || archiveRefreshRetry || busy) return;
    setBusy('archive-page');
    try {
      await loadArchivePage(archivePage + 1, true, false);
    } finally {
      setBusy(null);
    }
  }

  const managerDialog = open ? createPortal(
    <div
      className="fixed inset-0 z-[95] bg-black/80 p-3 backdrop-blur-xl"
      onMouseDown={closeManager}
    >
      <aside
        className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-cyan-100/20 bg-[#050505]/95 shadow-[0_0_70px_rgba(103,232,249,.08)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/45">Дії персоналу</p>
            <h2 className="mt-1 text-2xl font-black">Керування архівом</h2>
          </div>
          <button
            type="button"
            aria-label="Закрити"
            disabled={Boolean(busy)}
            onClick={closeManager}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-100/30 bg-black/45 text-cyan-100 transition active:scale-95 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-white/10 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => changeView('active')}
              className={`rounded-2xl border px-3 py-2.5 text-xs font-black disabled:opacity-35 ${view === 'active' ? 'border-cyan-100/50 bg-black/45 text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,.1)]' : 'border-white/10 bg-black/25 text-white/45'}`}
            >
              Активні{activeTotal === null ? '' : ` · ${activeTotal}`}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => changeView('archive')}
              className={`rounded-2xl border px-3 py-2.5 text-xs font-black disabled:opacity-35 ${view === 'archive' ? 'border-cyan-100/50 bg-black/45 text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,.1)]' : 'border-white/10 bg-black/25 text-white/45'}`}
            >
              Архів{archiveTotal === null ? '' : ` · ${archiveTotal}`}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded-2xl border border-rose-300/30 bg-black/45 p-3 text-sm text-rose-100">{error}</div>}
          <div className="space-y-2">
            {loading && <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">Завантаження...</div>}
            {!loading && visibleLogs.map((log) => (
              <article key={log.id} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <div className="flex items-start gap-3">
                  <History size={17} className="mt-0.5 shrink-0 text-cyan-200" />
                  <div className="min-w-0 flex-1">
                    <p className="font-black">{log.action}</p>
                    <p className="mt-1 text-xs text-white/40">{staffName(log)} · {dateTimeLabel(log.createdAt)}</p>
                  </div>
                  <Archive size={18} className={view === 'archive' ? 'text-amber-100/60' : 'text-white/25'} />
                </div>

                {view === 'active' ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void archiveLog(log)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/35 px-3 py-2.5 text-xs font-black text-amber-100 disabled:opacity-35"
                  >
                    <Archive size={15} />
                    {busy === `archive:${log.id}` ? 'Архівуємо...' : 'Архівувати'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => requestPermanentDelete(log)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200/35 px-3 py-2.5 text-xs font-black text-rose-100 disabled:opacity-35"
                  >
                    <Trash2 size={15} />
                    Видалити назавжди
                  </button>
                )}
              </article>
            ))}
            {!loading && !visibleLogs.length && (
              <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">
                {view === 'active' ? 'Активних дій персоналу немає' : 'Архів дій персоналу порожній'}
              </div>
            )}
          </div>

          {!loading && view === 'active' && activeRefreshRetry && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void retryActiveRefresh()}
              className="mt-3 w-full rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 disabled:opacity-35"
            >
              {busy === 'active-retry' ? 'Оновлюємо...' : 'Спробувати ще'}
            </button>
          )}
          {!loading && view === 'active' && !activeRefreshRetry && activeHasMore && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void loadMoreActive()}
              className="mt-3 w-full rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 disabled:opacity-35"
            >
              {busy === 'active-page'
                ? 'Завантажуємо...'
                : `Показати ще · ${Math.max(0, (activeTotal || 0) - activeLogs.length)}`}
            </button>
          )}
          {!loading && view === 'archive' && archiveRefreshRetry && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void retryArchiveRefresh()}
              className="mt-3 w-full rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 disabled:opacity-35"
            >
              {busy === 'archive-retry' ? 'Оновлюємо...' : 'Спробувати ще'}
            </button>
          )}
          {!loading && view === 'archive' && !archiveRefreshRetry && archiveHasMore && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void loadMoreArchive()}
              className="mt-3 w-full rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 disabled:opacity-35"
            >
              {busy === 'archive-page'
                ? 'Завантажуємо...'
                : `Показати ще · ${Math.max(0, (archiveTotal || 0) - archivedLogs.length)}`}
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  const deleteDialog = deleteTarget ? createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/85 p-3 backdrop-blur-xl">
      <div className="w-full max-w-md rounded-[28px] border border-rose-200/30 bg-[#070707] p-5 shadow-[0_0_70px_rgba(244,63,94,.1)]">
        <h2 className="text-xl font-black">Видалити дію персоналу назавжди?</h2>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Запис «{deleteTarget.action}» буде видалено без можливості відновлення. Історію бронювань це не змінює.
        </p>
        {deleteError && (
          <div className="mt-3 rounded-2xl border border-rose-300/35 bg-black/45 p-3 text-sm text-rose-100">
            {deleteError}
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={cancelPermanentDelete}
            className="rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 disabled:opacity-35"
          >
            Скасувати
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void deleteLogPermanently()}
            className="rounded-2xl border border-rose-200/40 bg-black/35 px-4 py-3 text-sm font-black text-rose-100 disabled:opacity-35"
          >
            {busy === `delete:${deleteTarget.id}` ? 'Видаляємо...' : 'Видалити назавжди'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={openManager}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-white/[0.025] active:scale-[.985]"
      >
        <Archive size={16} />
        Керувати діями персоналу
      </button>
      {managerDialog}
      {deleteDialog}
    </>
  );
}
