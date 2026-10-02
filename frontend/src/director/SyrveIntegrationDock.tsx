import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Building2,
  Check,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  RefreshCcw,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react';

import {
  syrveApi,
  type SyrveIntegrationStatus,
  type SyrveOrganization,
  type SyrveCatalogPreview,
} from '../api/syrve';
import SyrveCatalogPreviewPanel from './SyrveCatalogPreviewPanel';
import SyrveReadinessPanel from './SyrveReadinessPanel';
import SyrveOrderDiagnosticsPanel from './SyrveOrderDiagnosticsPanel';

type Step = 1 | 2 | 3;

const EMPTY_STATUS: SyrveIntegrationStatus = {
  id: '',
  displayName: 'MOLO · Syrve',
  apiBaseUrl: 'https://api-eu.syrve.live',
  apiLoginMasked: null,
  hasCredentials: false,
  organizationId: null,
  organizationName: null,
  status: 'not_connected',
  lastCheckedAt: null,
  connectedAt: null,
  lastError: null,
  configurationRevision: null,
  settingsPrepared: false,
  confirmedLinks: 0,
  syncEnabled: false,
};

function dateTime(value: string | null): string {
  if (!value) return 'ще не перевірялось';
  return new Date(value).toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SyrveIntegrationDock() {
  const [status, setStatus] = useState<SyrveIntegrationStatus>(EMPTY_STATUS);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [displayName, setDisplayName] = useState('MOLO · Syrve');
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api-eu.syrve.live');
  const [apiLogin, setApiLogin] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [organizations, setOrganizations] = useState<SyrveOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [catalogPreview, setCatalogPreview] = useState<SyrveCatalogPreview | null>(null);
  const [mappingAcknowledged, setMappingAcknowledged] = useState(false);
  const requestVersion = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const version = requestVersion.current;
    try {
      const value = await syrveApi.getStatus();
      if (version !== requestVersion.current) return;
      setStatus(value);
      setDisplayName(value.displayName || 'MOLO · Syrve');
      setApiBaseUrl(value.apiBaseUrl || 'https://api-eu.syrve.live');
    } catch {
      if (version !== requestVersion.current) return;
      setStatus(EMPTY_STATUS);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function start(edit = false) {
    requestVersion.current++;
    setBusy(false);
    setCatalogPreview(null);
    setMappingAcknowledged(false);
    setShowLogin(false);
    setError(null);
    setNotice(null);
    setStep(1);
    setOrganizations([]);
    setOrganizationId('');
    setApiLogin('');
    if (!edit) {
      setDisplayName('MOLO · Syrve');
      setApiBaseUrl('https://api-eu.syrve.live');
    }
    setOpen(true);
  }

  function close() {
    requestVersion.current++;
    setBusy(false);
    setCatalogPreview(null);
    setMappingAcknowledged(false);
    setApiLogin('');
    setShowLogin(false);
    setStep(1);
    setOpen(false);
  }

  function chooseOrganization(id: string) {
    requestVersion.current++;
    setOrganizationId(id);
    setBusy(false);
    setCatalogPreview(null);
    setMappingAcknowledged(false);
    setError(null);
    setNotice(null);
  }

  async function testConnection() {
    if (!displayName.trim()) return setError('Вкажіть назву підключення');
    if (!apiBaseUrl.trim()) return setError('Вкажіть адресу API');
    if (!apiLogin.trim()) return setError('Введіть API-логін Syrve');

    const version = ++requestVersion.current;
    setCatalogPreview(null);
    setMappingAcknowledged(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syrveApi.test({
        displayName: displayName.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        apiLogin: apiLogin.trim(),
      });
      if (version !== requestVersion.current) return;
      setApiBaseUrl(result.apiBaseUrl);
      setOrganizations(result.organizations);
      setOrganizationId(result.organizations[0]?.id || '');
      setNotice('Доступ до Syrve підтверджено');
      setStep(2);
    } catch (cause: any) {
      if (version !== requestVersion.current) return;
      setError(cause?.message || 'Syrve не підтвердив доступ');
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  async function previewTables() {
    if (!organizationId) return setError('Оберіть ресторан Syrve');
    const version = ++requestVersion.current;
    setBusy(true);
    setCatalogPreview(null);
    setMappingAcknowledged(false);
    setError(null);
    setNotice(null);
    try {
      const preview = await syrveApi.previewTables({ displayName: displayName.trim(), apiBaseUrl: apiBaseUrl.trim(),
        apiLogin: apiLogin.trim(), organizationId });
      if (version !== requestVersion.current) return;
      if (preview.organization.id !== organizationId) throw new Error('Отримано відповідь для іншого ресторану');
      setCatalogPreview(preview);
    } catch (cause: any) {
      if (version !== requestVersion.current) return;
      setError(cause?.message || 'Не вдалося перевірити столи Syrve');
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  async function connect() {
    const organization = organizations.find((item) => item.id === organizationId);
    if (!organization) return setError('Оберіть ресторан Syrve');
    if (!catalogPreview || catalogPreview.organization.id !== organizationId) {
      return setError('Спочатку перевірте столи вибраного ресторану');
    }

    if (!catalogPreview.confirmation) return setError('Підтвердження зв’язків поки недоступне');
    if (catalogPreview.proposals.length && !mappingAcknowledged) return setError('Підтвердьте запропоновані зв’язки столів');

    const version = ++requestVersion.current;
    setBusy(true);
    setError(null);
    try {
      const result = await syrveApi.connect({
        displayName: displayName.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        apiLogin: apiLogin.trim(),
        organizationId: organization.id,
        organizationName: organization.name,
        confirmationProof: catalogPreview.confirmation.proof,
        pairs: catalogPreview.proposals.map(({ moloTableId, syrveTableId }) => ({ moloTableId, syrveTableId })),
      });
      if (version !== requestVersion.current) return;
      setStatus(result.integration);
      setApiLogin('');
      setStep(3);
    } catch (cause: any) {
      if (version !== requestVersion.current) return;
      setCatalogPreview(null);
      setMappingAcknowledged(false);
      setError(cause?.message || 'Не вдалося зберегти підключення');
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  async function recheck() {
    if (!status.configurationRevision) return setError('Серверна підготовка інтеграції ще не завершена');
    const version = ++requestVersion.current;
    setBusy(true);
    setError(null);
    try {
      const result = await syrveApi.recheck(status.configurationRevision);
      if (version !== requestVersion.current) return;
      setStatus(result.integration);
      setNotice('Підключення перевірено');
    } catch (cause: any) {
      if (version !== requestVersion.current) return;
      setError(cause?.message || 'Не вдалося перевірити Syrve');
      await load();
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  async function disconnect() {
    if (!status.configurationRevision) return setError('Серверна підготовка інтеграції ще не завершена');
    const reason = window.prompt('Причина відключення Syrve', 'Зміна налаштувань');
    if (reason === null) return;
    if (!window.confirm('Відключити Syrve? Збережені дані доступу буде видалено.')) return;

    const version = ++requestVersion.current;
    setBusy(true);
    setError(null);
    try {
      const result = await syrveApi.disconnect(status.configurationRevision, reason.trim());
      if (version !== requestVersion.current) return;
      setStatus(result.integration);
      setNotice('Syrve відключено');
      close();
    } catch (cause: any) {
      if (version !== requestVersion.current) return;
      setError(cause?.message || 'Не вдалося відключити Syrve');
      await load();
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  const connected = status.status === 'connected';
  const tone = connected
    ? 'border-emerald-200/45 bg-emerald-400/10 shadow-[0_0_38px_rgba(52,211,153,.16)]'
    : status.status === 'error'
      ? 'border-red-200/40 bg-red-500/10 shadow-[0_0_34px_rgba(239,68,68,.13)]'
      : 'border-cyan-200/35 bg-cyan-400/10 shadow-[0_0_34px_rgba(34,211,238,.12)]';

  return (
    <>
      <button
        type="button"
        title={connected ? `Syrve підключено · ${status.organizationName || 'організація'}` : 'Налаштувати підключення Syrve'}
        aria-label={connected ? 'Syrve підключено. Відкрити налаштування' : 'Підключити Syrve'}
        onClick={() => status.hasCredentials ? setOpen(true) : start()}
        className={`fixed bottom-24 right-3 z-50 grid h-14 w-14 place-items-center rounded-2xl border bg-black/85 backdrop-blur-2xl transition active:scale-[0.95] sm:right-5 ${tone}`}
      >
        <Cloud size={24} className={connected ? 'text-emerald-100' : status.status === 'error' ? 'text-red-100' : 'text-cyan-100'} />
        <span className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.95)]' : status.status === 'error' ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,.9)]' : 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,.85)]'}`} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#020607]/95 p-3 text-white backdrop-blur-2xl">
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.18),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(52,211,153,.13),transparent_42%)]" />
          <main className="relative mx-auto min-h-[calc(100dvh-24px)] max-w-3xl rounded-[32px] border border-cyan-200/25 bg-black/65 p-4 shadow-[0_0_60px_rgba(34,211,238,.12)] sm:p-6">
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-cyan-200/35 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,.12)]"><PlugZap size={26} /></span>
                <div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/50">MOLO · Інтеграції</p><h1 className="mt-1 text-3xl font-black">Syrve Cloud API</h1></div>
              </div>
              <button type="button" onClick={close} aria-label="Закрити налаштування Syrve" className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/60"><X size={19} /></button>
            </header>

            <div className="mt-6 grid grid-cols-3 gap-2">
              <StepBadge number="1" label="Дані доступу" active={step === 1} done={step > 1} />
              <StepBadge number="2" label="Ресторан і столи" active={step === 2} done={step > 2} />
              <StepBadge number="3" label="Готово" active={step === 3} done={false} />
            </div>

            {(error || notice) && <div className={`mt-4 rounded-2xl border p-3 text-sm ${error ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'}`}>{error || notice}</div>}

            {step === 1 && (
              <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">Крок 1</p>
                <h2 className="mt-1 text-2xl font-black">Дані доступу</h2>
                <p className="mt-2 text-sm text-white/45">Введіть API-логін, наданий Syrve. Пароль Windows і PIN касира не потрібні.</p>

                <Field icon={<Building2 size={18} />} label="Назва підключення">
                  <input disabled={busy} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-12 w-full bg-transparent px-3 text-sm outline-none" />
                </Field>
                <Field icon={<Link2 size={18} />} label="Адреса API">
                  <input disabled={busy} value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} inputMode="url" className="h-12 w-full bg-transparent px-3 text-sm outline-none" />
                </Field>
                <Field icon={<KeyRound size={18} />} label="API-логін / ключ">
                  <input disabled={busy} value={apiLogin} onChange={(event) => setApiLogin(event.target.value)} type={showLogin ? 'text' : 'password'} autoComplete="off" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
                  <button type="button" onClick={() => setShowLogin((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/45">{showLogin ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </Field>

                <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-3 text-xs text-emerald-50/70"><LockKeyhole size={16} className="mb-2" />Після збереження повний ключ більше не показується. Backend зберігає його у зашифрованому вигляді.</div>
                <button type="button" disabled={busy} onClick={() => void testConnection()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200/50 bg-cyan-400/15 px-4 py-4 font-black text-cyan-50 shadow-[0_0_28px_rgba(34,211,238,.12)] disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <RefreshCcw size={18} />}Перевірити підключення</button>
              </section>
            )}

            {step === 2 && (
              <section className="mt-5 rounded-[28px] border border-emerald-200/20 bg-neutral-950/80 p-4 sm:p-5">
                <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-full border border-emerald-200/35 bg-emerald-400/10 text-emerald-100"><Check size={24} /></span><div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/50">Доступ підтверджено</p><h2 className="mt-1 text-2xl font-black">Оберіть ресторан</h2></div></div>
                <div className="mt-5 grid gap-2">{organizations.map((organization) => <button key={organization.id} disabled={busy} type="button" onClick={() => chooseOrganization(organization.id)} className={`flex items-center justify-between rounded-2xl border p-4 text-left disabled:opacity-40 ${organizationId === organization.id ? 'border-emerald-200/50 bg-emerald-400/12 text-emerald-50 shadow-[0_0_24px_rgba(52,211,153,.1)]' : 'border-white/10 bg-black/30 text-white/60'}`}><div className="flex items-center gap-3"><Building2 size={20} /><div><p className="font-black">{organization.name}</p><p className="mt-1 text-xs opacity-45">{organization.id}</p></div></div>{organizationId === organization.id && <Check size={19} />}</button>)}</div>
                {!organizations.length && <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-5 text-center text-white/35">Syrve не повернув доступних організацій</div>}
                <button type="button" disabled={busy || !organizationId} onClick={() => void previewTables()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200/50 bg-cyan-400/15 p-4 font-black text-cyan-50 disabled:opacity-40">{busy && <LoaderCircle className="animate-spin" size={18} />}Перевірити столи</button>
                {catalogPreview && <SyrveCatalogPreviewPanel preview={catalogPreview} />}
                {catalogPreview?.confirmation && catalogPreview.proposals.length > 0 && <label className="mt-4 flex gap-3 rounded-2xl border border-amber-200/30 bg-amber-300/[0.07] p-4 text-sm text-amber-50">
                  <input type="checkbox" disabled={busy} checked={mappingAcknowledged} onChange={(event) => setMappingAcknowledged(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
                  <span>Я перевірив(ла) та підтверджую запропоновані зв’язки столів ({catalogPreview.proposals.length}). Дані доступу й підтверджені зв’язки буде збережено разом.</span>
                </label>}
                <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => { setCatalogPreview(null); setMappingAcknowledged(false); setStep(1); }} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 font-black text-white/55">Назад</button><button type="button" disabled={busy || !catalogPreview?.confirmation || catalogPreview.organization.id !== organizationId || (catalogPreview.proposals.length > 0 && !mappingAcknowledged)} onClick={() => void connect()} className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/50 bg-emerald-400/15 p-4 font-black text-emerald-50 disabled:opacity-40">{catalogPreview?.proposals.length ? 'Підтвердити зв’язки' : 'Зберегти підключення'}</button></div>
              </section>
            )}

            {step === 3 && (
              <section className="mt-5 rounded-[28px] border border-emerald-200/30 bg-[radial-gradient(circle_at_top,rgba(52,211,153,.13),transparent_55%)] p-5 text-center shadow-[0_0_44px_rgba(52,211,153,.1)]">
                <span className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-emerald-200/40 bg-emerald-400/12 text-emerald-100"><ShieldCheck size={39} /></span>
                <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-emerald-100/55">Підключення збережено</p>
                <h2 className="mt-2 text-3xl font-black">Syrve доступний</h2>
                <p className="mt-3 text-white/55">Організація: {status.organizationName || 'обрана'}</p>
                <div className="mx-auto mt-5 max-w-xl rounded-2xl border border-amber-200/25 bg-amber-300/[0.07] p-4 text-left"><p className="font-black text-amber-100">Синхронізація ще не ввімкнена</p><p className="mt-2 text-sm text-white/50">Доступ до ресторану збережено. Підтверджених зв’язків: {status.confirmedLinks}. Автоматичні статуси ще не ввімкнені.</p></div>
                <button type="button" onClick={close} className="mt-5 w-full rounded-2xl border border-emerald-200/50 bg-emerald-400/15 p-4 font-black text-emerald-50">Готово</button>
              </section>
            )}

            {status.hasCredentials && step !== 3 && (
              <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">Поточне підключення</p><h2 className="mt-1 text-xl font-black">{status.displayName}</h2><p className="mt-2 text-sm text-white/45">{status.organizationName} · {status.apiLoginMasked}</p><p className="mt-1 text-xs text-white/30">Перевірено: {dateTime(status.lastCheckedAt)}</p></div><span className="rounded-full border border-emerald-200/35 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100">{connected ? 'Підключено' : 'Потребує перевірки'}</span></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3"><button type="button" disabled={busy} onClick={() => void recheck()} className="rounded-2xl border border-cyan-200/35 bg-cyan-400/10 p-3 text-sm font-black text-cyan-100 disabled:opacity-40">Перевірити</button><button type="button" disabled={busy} onClick={() => start(true)} className="rounded-2xl border border-amber-200/35 bg-amber-300/10 p-3 text-sm font-black text-amber-100 disabled:opacity-40">Змінити дані</button><button type="button" disabled={busy} onClick={() => void disconnect()} className="flex items-center justify-center gap-2 rounded-2xl border border-red-200/35 bg-red-500/10 p-3 text-sm font-black text-red-100 disabled:opacity-40"><Unplug size={16} />Відключити</button></div>
              </section>
            )}
            <SyrveReadinessPanel configurationRevision={status.configurationRevision} />
            <SyrveOrderDiagnosticsPanel configurationRevision={status.configurationRevision}
              organizationId={status.organizationId} linkedTables={status.confirmedLinks}
              connectionReady={connected && status.hasCredentials && status.settingsPrepared} busy={busy} />
          </main>
        </div>
      )}
    </>
  );
}

function StepBadge({ number, label, active, done }: { number: string; label: string; active: boolean; done: boolean }) {
  return <div className={`rounded-2xl border p-3 text-center ${active ? 'border-cyan-200/45 bg-cyan-400/12 text-cyan-50' : done ? 'border-emerald-200/30 bg-emerald-400/08 text-emerald-100' : 'border-white/10 bg-white/[0.025] text-white/35'}`}><span className="mx-auto grid h-7 w-7 place-items-center rounded-full border border-current text-xs font-black">{done ? <Check size={15} /> : number}</span><p className="mt-2 text-[10px] font-black sm:text-xs">{label}</p></div>;
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <label className="mt-4 block"><span className="text-xs font-black uppercase tracking-[0.16em] text-white/35">{label}</span><span className="mt-2 flex min-h-12 items-center rounded-2xl border border-white/10 bg-black/35 pl-3 text-white/45 focus-within:border-cyan-200/45 focus-within:text-cyan-100">{icon}{children}</span></label>;
}
