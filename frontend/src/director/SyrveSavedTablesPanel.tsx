import { useEffect, useRef, useState } from 'react';
import { syrveApi, type SyrveCatalogPreview } from '../api/syrve';
import SyrveCatalogPreviewPanel from './SyrveCatalogPreviewPanel';
import { syrveOperationError } from './services/syrveOperationErrors';
import { syrveConfirmationDeadline, syrveConfirmationExpired } from './services/syrveConfirmationTime';

type Preview = SyrveCatalogPreview & { configurationRevision: string; confirmationDeadline: number | null };
type Props = { configurationRevision: string | null; organizationId: string | null; linkedTables: number;
  syncEnabled: boolean; busy: boolean; onBusyChange: (working: boolean) => void; onConfirmed: () => Promise<void> };

export default function SyrveSavedTablesPanel(props: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const allowed = Boolean(props.configurationRevision && props.organizationId && !props.busy && !working);

  useEffect(() => {
    version.current++; setPreview(null); setAcknowledged(false); setError(null); setWorking(false);
    return () => { version.current++; };
  }, [props.configurationRevision, props.organizationId, props.syncEnabled]);

  async function check() {
    if (!allowed || !props.configurationRevision) return;
    const request = ++version.current, startedAt = performance.now();
    setWorking(true); props.onBusyChange(true); setPreview(null); setAcknowledged(false); setError(null);
    try {
      const value = await syrveApi.previewSavedTables(props.configurationRevision);
      if (request !== version.current) return;
      if (value.configurationRevision !== props.configurationRevision || value.organization.id !== props.organizationId) throw new Error();
      const confirmationDeadline = value.confirmation
        ? syrveConfirmationDeadline(value.checkedAt, value.confirmation.expiresAt, startedAt) : null;
      setPreview({ ...value, confirmationDeadline });
    } catch (cause) {
      if (request === version.current) setError(syrveOperationError(cause, 'Не вдалося перевірити список столів. Повторіть перевірку.'));
    } finally {
      if (request === version.current) { setWorking(false); props.onBusyChange(false); }
    }
  }

  async function confirm() {
    if (!allowed || props.syncEnabled || !acknowledged || !preview?.confirmation || !props.configurationRevision
      || preview.configurationRevision !== props.configurationRevision || !preview.proposals.length) return;
    if (preview.confirmationDeadline === null || syrveConfirmationExpired(preview.confirmationDeadline)) {
      setPreview(null); setAcknowledged(false); setError('Перевірка застаріла. Повторіть перевірку списку столів.'); return;
    }
    const request = ++version.current;
    setWorking(true); props.onBusyChange(true); setError(null); setAcknowledged(false);
    try {
      const result = await syrveApi.confirmSavedTables(props.configurationRevision, preview.confirmation.proof,
        preview.proposals.map(({ moloTableId, syrveTableId }) => ({ moloTableId, syrveTableId })));
      if (request !== version.current) return;
      if (result.integration.syncEnabled || result.confirmedPairs !== preview.proposals.length
        || result.integration.organizationId !== props.organizationId) throw new Error();
      setPreview(null);
      await props.onConfirmed();
    } catch (cause) {
      if (request === version.current) {
        setPreview(null); setError(syrveOperationError(cause, 'Збереження зв’язків не підтверджено. Оновіть підключення та повторіть перевірку.'));
      }
    } finally {
      if (request === version.current) { setWorking(false); props.onBusyChange(false); }
    }
  }

  return <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5">
    <h2 className="text-xl font-black">Зв’язки столів із Syrve</h2>
    <p className="mt-2 text-sm text-white/55">Підтверджених зв’язків: {props.linkedTables}. Автостатуси працюють лише для пов’язаних столів.</p>
    <button type="button" disabled={!allowed} onClick={() => void check()} className="mt-4 rounded-2xl border border-cyan-200/35 px-4 py-3 text-sm font-bold disabled:opacity-40">Перевірити список столів Syrve</button>
    {working && <p className="mt-3 text-sm" role="status">Перевіряємо список і зв’язки столів…</p>}
    {error && <p className="mt-3 text-sm text-amber-100" role="alert">{error}</p>}
    {preview && <SyrveCatalogPreviewPanel preview={preview} />}
    {!!preview?.missingInSyrve.length && <p className="mt-3 text-sm text-amber-100">Якщо потрібного столу немає у списку, перевірте в Syrve його секцію, доступність для бронювань і права API-підключення.</p>}
    {!!preview?.proposals.length && (props.syncEnabled
      ? <p className="mt-3 text-sm text-amber-100">Щоб додати зв’язки, спочатку вимкніть автостатуси, потім повторіть перевірку списку.</p>
      : <div className="mt-4 rounded-2xl border border-amber-200/25 p-4 text-sm">
        <label className="flex gap-3"><input type="checkbox" checked={acknowledged} disabled={working}
          onChange={event => setAcknowledged(event.target.checked)} />
          <span>Я перевірив(ла) та підтверджую запропоновані зв’язки ({preview.proposals.length}).</span></label>
        <button type="button" disabled={!allowed || !acknowledged || !preview.confirmation || preview.confirmationDeadline === null}
          onClick={() => void confirm()} className="mt-4 rounded-2xl border border-emerald-200/40 px-4 py-3 font-bold disabled:opacity-40">Додати підтверджені зв’язки</button>
      </div>)}
  </section>;
}
