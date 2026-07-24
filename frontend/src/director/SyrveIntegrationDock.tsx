import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  ChevronRight,
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
} from '../api/syrve';

type WizardStep = 1 | 2 | 3;

const DEFAULT_API_URL = 'https://api-eu.syrve.live';

function formatDateTime(value: string | null) {
  if (!value) return 'Ще не перевірялося';
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusText(status: SyrveIntegrationStatus['status'] | undefined) {
  if (status === 'connected') return 'Підключено';
  if (status === 'error') return 'Потрібна перевірка';
  return 'Не підключено';
}

export default function SyrveIntegrationDock() {
  const [status, setStatus] = useState<SyrveIntegrationStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [displayName, setDisplayName] = useState('MOLO · Основний ресторан');
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_URL);
  const [apiLogin, setApiLogin] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [organizations, setOrganizations] = useState<SyrveOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = status?.status === 'connected';
  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === organizationId) || null,
    [organizations, organizationId],
  );

  async function loadStatus() {
    try {
      const value = await syrveApi.getStatus();
      setStatus(value);
      setDisplayName(value.displayName || 'MOLO · Основний ресторан');
      setApiBaseUrl(value.apiBaseUrl || DEFAULT_API_URL);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося завантажити стан Syrve');
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  function startWizard() {
    setEditing(true);
    setStep(1);
    setOrganizations([]);
    setOrganizationId('');
    setApiLogin('');
    setError(null);
    setNotice(null);
    setOpen(true);
  }

  async function testConnection() {
    if (!displayName.trim()) return setError('Вкажіть назву підключення');
    if (!apiBaseUrl.trim()) return setError('Вкажіть адресу Syrve API');
    if (!apiLogin.trim()) return setError('Введіть API-логін');

    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const result = await syrveApi.test({
        displayName: displayName.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        apiLogin: apiLogin.trim(),
      });
      setApiBaseUrl(result.apiBaseUrl);
      setOrganizations(result.organizations);
      setOrganizationId(result.organizations[0]?.id || '');
      setStep(2);
      setNotice('Syrve відповів. Оберіть організацію ресторану.');
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося перевірити підключення Syrve');
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    if (!selectedOrganization) return setError('Оберіть організацію Syrve');
    setBusy('connect');
    setError(null);
    setNotice(null);
    try {
      const result = await syrveApi.connect({
        displayName: displayName.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        apiLogin: apiLogin.trim(),
        organizationId: selectedOrganization.id,
        organizationName: selectedOrganization.name,
      });
      setStatus(result.integration);
      setStep(3);
      setNotice('Доступ до Syrve Cloud API підключено.');
      setApiLogin('');
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося підключити Syrve');
    } finally {
      setBusy(null);
    }
  }

  async function recheck() {
    setBusy('recheck');
    setError(null);
    setNotice(null);
    try {
      const result = await syrveApi.recheck();
      setStatus(result.integration);
      setNotice('Підключення Syrve працює.');
    } catch (cause: any) {
      setError(cause?.message || 'Перевірка Syrve завершилася помилкою');
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    const confirmed = window.confirm(
      'Відключити Syrve? Збережений API-логін буде видалено з сервера.',
    );
    if (!confirmed) return;
    const reason = window.prompt('Причина відключення:', 'Зміна налаштувань') || undefined;

    setBusy('disconnect');
    setError(null);
    setNotice(null);
    try {
      const result = await syrveApi.disconnect(reason);
      setStatus(result.integration);
      setEditing(false);
      setStep(1);
      setOrganizations([]);
      setOrganizationId('');
      setApiLogin('');
      setNotice('Syrve відключено. Дані доступу видалено.');
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося відключити Syrve');
    } finally {
      setBusy(null);
    }
  }

  const cardTone = connected
    ? 'border-emerald-200/40 bg-emerald-400/10 shadow-[0_0_32px_rgba(52,211,153,.16)]'
    : status?.status === 'error'
      ? 'border-red-200/40 bg-red-500/10 shadow-[0_0_32px_rgba(248,113,113,.14)]'
      : 'border-cyan-200/35 bg-cyan-300/10 shadow-[0_0_30px_rgba(103,232,249,.12)]';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setEditing(false);
          setError(null);
          setNotice(null);
        }}
        className={`fixed bottom-28 right-4 z-50 flex items-center gap-3 rounded-[22px] border px-4 py-3 text-left text-white backdrop-blur-xl transition hover:-translate-y-0.5 active:scale-95 ${cardTone}`}
        aria-label="Відкрити інтеграцію Syrve"
      >
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-black/25">
          <PlugZap size={21} className={connected ? 'text-emerald-200' : 'text-cyan-100'} />
        </span>
        <span className="hidden sm:block">
          <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
            Інтеграції
          </span>
          <span className="mt-0.5 block text-sm font-black">Syrve</span>
        </span>
        <span
          className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]' : status?.status === 'error' ? 'bg-red-400' : 'bg-white/30'}`}
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/85 p-3 backdrop-blur-2xl sm:p-6">
          <div className="mx-auto min-h-full max-w-4xl">
            <section className="relative overflow-hidden rounded-[30px] border border-cyan-200/20 bg-neutral-950 shadow-[0_0_70px_rgba(34,211,238,.1)]">
              <div className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-40 -left-28 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />

              <header className="relative flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-7">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[20px] border border-cyan-200/30 bg-cyan-300/10 text-cyan-100 shadow-[0_0_24px_rgba(103,232,249,.12)]">
                    <Cloud size={27} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/50">
                      Система · Інтеграції
                    </p>
                    <h2 className="mt-1 text-2xl font-black sm:text-3xl">Syrve Cloud API</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
                      Підключення доступу до ресторану Syrve без зміни карт, номерів столів або гостьового сайту.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 active:scale-95"
                  aria-label="Закрити"
                >
                  <X size={19} />
                </button>
              </header>

              <div className="relative p-5 sm:p-7">
                {(error || notice) && (
                  <div
                    className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'}`}
                  >
                    {error || notice}
                  </div>
                )}

                {connected && !editing && step !== 3 ? (
                  <ConnectedView
                    status={status as SyrveIntegrationStatus}
                    busy={busy}
                    onRecheck={() => void recheck()}
                    onEdit={startWizard}
                    onDisconnect={() => void disconnect()}
                  />
                ) : (
                  <div className="space-y-5">
                    <Progress step={step} />

                    {step === 1 && (
                      <div className="grid gap-5 lg:grid-cols-[1fr_.72fr]">
                        <div className="rounded-[24px] border border-white/10 bg-black/30 p-4 sm:p-5">
                          <div className="flex items-center gap-3">
                            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan-200/25 bg-cyan-300/10 text-cyan-100">
                              <KeyRound size={19} />
                            </span>
                            <div>
                              <p className="font-black">Дані доступу</p>
                              <p className="mt-1 text-xs text-white/35">Вводяться один раз і зберігаються зашифровано.</p>
                            </div>
                          </div>

                          <div className="mt-5 space-y-4">
                            <Field label="Назва підключення">
                              <input
                                value={displayName}
                                onChange={(event) => setDisplayName(event.target.value)}
                                placeholder="MOLO · Основний ресторан"
                                className="h-13 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-sm outline-none transition focus:border-cyan-200/45"
                              />
                            </Field>

                            <Field label="Адреса Syrve API">
                              <div className="relative">
                                <Link2 size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                                <input
                                  value={apiBaseUrl}
                                  onChange={(event) => setApiBaseUrl(event.target.value)}
                                  placeholder={DEFAULT_API_URL}
                                  className="h-13 w-full rounded-2xl border border-white/10 bg-neutral-950 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-cyan-200/45"
                                />
                              </div>
                            </Field>

                            <Field label="API-логін">
                              <div className="relative">
                                <LockKeyhole size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                                <input
                                  type={showLogin ? 'text' : 'password'}
                                  value={apiLogin}
                                  onChange={(event) => setApiLogin(event.target.value)}
                                  placeholder="Вставте API-логін Syrve"
                                  autoComplete="off"
                                  className="h-13 w-full rounded-2xl border border-white/10 bg-neutral-950 py-3 pl-11 pr-12 text-sm outline-none transition focus:border-cyan-200/45"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowLogin((value) => !value)}
                                  className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-white/35 hover:bg-white/5"
                                  aria-label={showLogin ? 'Приховати API-логін' : 'Показати API-логін'}
                                >
                                  {showLogin ? <EyeOff size={17} /> : <Eye size={17} />}
                                </button>
                              </div>
                            </Field>
                          </div>

                          <button
                            type="button"
                            onClick={() => void testConnection()}
                            disabled={busy === 'test' || !displayName.trim() || !apiBaseUrl.trim() || !apiLogin.trim()}
                            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200/45 bg-cyan-300/15 px-4 py-3.5 text-sm font-black text-cyan-50 shadow-[0_0_28px_rgba(103,232,249,.12)] transition hover:bg-cyan-300/20 active:scale-[0.99] disabled:opacity-35"
                          >
                            {busy === 'test' ? <LoaderCircle size={18} className="animate-spin" /> : <RefreshCcw size={18} />}
                            Перевірити підключення
                          </button>
                        </div>

                        <SecurityPanel />
                      </div>
                    )}

                    {step === 2 && (
                      <div className="grid gap-5 lg:grid-cols-[1fr_.72fr]">
                        <div className="rounded-[24px] border border-emerald-200/20 bg-emerald-400/[0.055] p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-200/30 bg-emerald-400/10 text-emerald-100">
                              <Check size={21} />
                            </span>
                            <div>
                              <p className="text-lg font-black">Syrve відповів</p>
                              <p className="mt-1 text-sm text-white/45">Оберіть ресторан, який буде пов’язаний із MOLO.</p>
                            </div>
                          </div>

                          <div className="mt-5 space-y-2">
                            {organizations.map((organization) => {
                              const active = organization.id === organizationId;
                              return (
                                <button
                                  key={organization.id}
                                  type="button"
                                  onClick={() => setOrganizationId(organization.id)}
                                  className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${active ? 'border-emerald-200/45 bg-emerald-400/12 shadow-[0_0_24px_rgba(52,211,153,.1)]' : 'border-white/10 bg-black/25 hover:border-white/20'}`}
                                >
                                  <span className="flex min-w-0 items-center gap-3">
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/55">
                                      <Building2 size={18} />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-black">{organization.name}</span>
                                      <span className="mt-1 block truncate text-[10px] text-white/30">{organization.id}</span>
                                    </span>
                                  </span>
                                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${active ? 'border-emerald-200 bg-emerald-400 text-neutral-950' : 'border-white/20'}`}>
                                    {active && <Check size={14} />}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-5 grid grid-cols-[auto_1fr] gap-2">
                            <button
                              type="button"
                              onClick={() => setStep(1)}
                              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/55"
                            >
                              Назад
                            </button>
                            <button
                              type="button"
                              onClick={() => void connect()}
                              disabled={busy === 'connect' || !selectedOrganization}
                              className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/45 bg-emerald-400/15 px-4 py-3 text-sm font-black text-emerald-50 shadow-[0_0_26px_rgba(52,211,153,.12)] disabled:opacity-35"
                            >
                              {busy === 'connect' ? <LoaderCircle size={18} className="animate-spin" /> : <PlugZap size={18} />}
                              Приєднати Syrve
                            </button>
                          </div>
                        </div>

                        <SecurityPanel />
                      </div>
                    )}

                    {step === 3 && status && (
                      <div className="rounded-[26px] border border-emerald-200/35 bg-emerald-400/[0.07] p-5 text-center shadow-[0_0_45px_rgba(52,211,153,.12)] sm:p-8">
                        <span className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] border border-emerald-200/40 bg-emerald-400/15 text-emerald-100 shadow-[0_0_28px_rgba(52,211,153,.18)]">
                          <Check size={38} />
                        </span>
                        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-emerald-100/55">Готово</p>
                        <h3 className="mt-2 text-3xl font-black">Syrve підключено</h3>
                        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
                          Доступ до організації «{status.organizationName}» перевірено. Дані входу зашифровані та більше не показуються у пульті.
                        </p>
                        <div className="mx-auto mt-5 max-w-xl rounded-2xl border border-amber-200/25 bg-amber-300/[0.06] p-4 text-left">
                          <p className="text-sm font-black text-amber-100">Наступний етап</p>
                          <p className="mt-2 text-xs leading-5 text-white/45">
                            Синхронізація столів, замовлень і статусів ще не ввімкнена. Підключення зараз лише безпечно зберігає та перевіряє API-доступ.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(false);
                            setOpen(false);
                            setStep(1);
                          }}
                          className="mt-6 rounded-2xl border border-emerald-200/45 bg-emerald-400/15 px-6 py-3 text-sm font-black text-emerald-50"
                        >
                          Завершити
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

function ConnectedView({
  status,
  busy,
  onRecheck,
  onEdit,
  onDisconnect,
}: {
  status: SyrveIntegrationStatus;
  busy: string | null;
  onRecheck: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_.72fr]">
      <div className="rounded-[26px] border border-emerald-200/35 bg-emerald-400/[0.065] p-5 shadow-[0_0_42px_rgba(52,211,153,.11)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] border border-emerald-200/35 bg-emerald-400/12 text-emerald-100">
              <PlugZap size={23} />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/55">Syrve</p>
              <h3 className="mt-1 text-2xl font-black">{statusText(status.status)}</h3>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]" />
            API доступний
          </span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Info label="Підключення" value={status.displayName} />
          <Info label="Організація" value={status.organizationName || '—'} />
          <Info label="API-логін" value={status.apiLoginMasked || 'Приховано'} />
          <Info label="Остання перевірка" value={formatDateTime(status.lastCheckedAt)} />
        </div>

        <div className="mt-4 rounded-2xl border border-amber-200/25 bg-amber-300/[0.06] p-4">
          <p className="text-sm font-black text-amber-100">Синхронізація ще не ввімкнена</p>
          <p className="mt-2 text-xs leading-5 text-white/45">
            Підключення підтверджує доступ до Syrve. Передача столів, замовлень і статусів буде додана окремим безпечним етапом.
          </p>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onRecheck}
            disabled={busy === 'recheck'}
            className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/35 bg-emerald-400/10 px-3 py-3 text-xs font-black text-emerald-100 disabled:opacity-40"
          >
            {busy === 'recheck' ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            Перевірити
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={Boolean(busy)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/35 bg-cyan-300/10 px-3 py-3 text-xs font-black text-cyan-100 disabled:opacity-40"
          >
            <KeyRound size={16} />
            Змінити дані
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy === 'disconnect'}
            className="flex items-center justify-center gap-2 rounded-2xl border border-red-300/30 bg-red-500/10 px-3 py-3 text-xs font-black text-red-100 disabled:opacity-40"
          >
            {busy === 'disconnect' ? <LoaderCircle size={16} className="animate-spin" /> : <Unplug size={16} />}
            Відключити
          </button>
        </div>
      </div>

      <SecurityPanel />
    </div>
  );
}

function Progress({ step }: { step: WizardStep }) {
  const items = [
    { number: 1 as WizardStep, label: 'Дані доступу' },
    { number: 2 as WizardStep, label: 'Організація' },
    { number: 3 as WizardStep, label: 'Готово' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => {
        const active = step === item.number;
        const complete = step > item.number;
        return (
          <div
            key={item.number}
            className={`rounded-2xl border p-3 transition ${active ? 'border-cyan-200/40 bg-cyan-300/10 text-cyan-100' : complete ? 'border-emerald-200/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/[0.025] text-white/30'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-black ${active ? 'border-cyan-200 bg-cyan-300 text-neutral-950' : complete ? 'border-emerald-200 bg-emerald-400 text-neutral-950' : 'border-white/15'}`}>
                {complete ? <Check size={14} /> : item.number}
              </span>
              <span className="hidden truncate text-xs font-bold sm:block">{item.label}</span>
              {item.number < 3 && <ChevronRight size={14} className="ml-auto hidden opacity-40 sm:block" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SecurityPanel() {
  return (
    <aside className="rounded-[24px] border border-violet-200/20 bg-violet-400/[0.045] p-5">
      <span className="grid h-12 w-12 place-items-center rounded-[18px] border border-violet-200/30 bg-violet-400/10 text-violet-100">
        <ShieldCheck size={23} />
      </span>
      <h3 className="mt-4 text-lg font-black">Безпечне підключення</h3>
      <div className="mt-4 space-y-3 text-sm text-white/45">
        <SecurityLine text="Доступ має лише Директор" />
        <SecurityLine text="API-логін шифрується на сервері" />
        <SecurityLine text="Повний логін після збереження не показується" />
        <SecurityLine text="Дозволені лише офіційні HTTPS-адреси Syrve" />
        <SecurityLine text="Підключення та відключення записуються в історію" />
      </div>
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">Важливо</p>
        <p className="mt-2 text-xs leading-5 text-white/40">
          Пароль Windows, PIN касира та пароль від термінала сюди вводити не потрібно.
        </p>
      </div>
    </aside>
  );
}

function SecurityLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-emerald-200/25 bg-emerald-400/10 text-emerald-100">
        <Check size={12} />
      </span>
      <span>{text}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-white/40">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/30">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white/75">{value}</p>
    </div>
  );
}
