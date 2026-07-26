import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';

import { staffApi } from '../api/staff';

export default function DirectorAccessSettingsDock() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fullName, setFullName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const value = await staffApi.getDirectorAccess();
      setConfigured(value.configured);
      setFullName(value.fullName);
      setLoginName(value.loginName);
      if (!value.configured) setOpen(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося завантажити налаштування входу');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!fullName.trim()) return setError('Вкажіть ім’я Директора');
    if (!loginName.trim()) return setError('Вкажіть ім’я для входу');
    if (newPassword.length < 6) return setError('Новий пароль має містити щонайменше 6 символів');
    if (newPassword !== confirmPassword) return setError('Новий пароль і підтвердження не збігаються');
    if (configured && !currentPassword) return setError('Введіть поточний пароль');

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const value = await staffApi.updateDirectorAccess({
        fullName: fullName.trim(),
        loginName: loginName.trim(),
        currentPassword: configured ? currentPassword : undefined,
        newPassword,
        confirmPassword,
      });

      setConfigured(value.configured);
      setFullName(value.fullName);
      setLoginName(value.loginName);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Дані входу збережено. Тимчасовий PIN 1111 вимкнено.');
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося зберегти дані входу');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed left-3 top-24 z-50 flex h-12 items-center gap-2 rounded-2xl border px-3 text-sm font-black backdrop-blur-2xl transition active:scale-95 sm:left-5 ${configured ? 'border-amber-200/35 bg-amber-300/10 text-amber-100 shadow-[0_0_26px_rgba(251,191,36,.1)]' : 'border-red-200/45 bg-red-500/15 text-red-100 shadow-[0_0_28px_rgba(239,68,68,.14)]'}`}
      >
        <LockKeyhole size={18} />
        <span className="hidden sm:inline">Налаштування входу</span>
        {!configured && <span className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,.8)]" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-[95] overflow-y-auto bg-[#050403]/95 p-3 text-white backdrop-blur-2xl">
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,.17),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(244,63,94,.1),transparent_42%)]" />
          <main className="relative mx-auto min-h-[calc(100dvh-24px)] max-w-2xl rounded-[32px] border border-amber-200/25 bg-black/70 p-4 shadow-[0_0_60px_rgba(251,191,36,.1)] sm:p-6">
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100">
                  <ShieldCheck size={27} />
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/50">MOLO · Директор</p>
                  <h1 className="mt-1 text-2xl font-black sm:text-3xl">Налаштування входу</h1>
                </div>
              </div>
              {configured && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/60"
                >
                  <X size={19} />
                </button>
              )}
            </header>

            {!configured && (
              <div className="mt-5 rounded-2xl border border-red-200/30 bg-red-500/[0.08] p-4 text-sm text-red-50/80">
                Ви увійшли за тимчасовим PIN <strong>1111</strong>. Створіть власне ім’я та пароль. До збереження це вікно не закривається.
              </div>
            )}

            {(error || notice) && (
              <div className={`mt-4 rounded-2xl border p-3 text-sm ${error ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'}`}>
                {error || notice}
              </div>
            )}

            {loading ? (
              <div className="grid min-h-72 place-items-center">
                <LoaderCircle className="animate-spin text-amber-200" size={28} />
              </div>
            ) : (
              <section className="mt-5 rounded-[28px] border border-white/10 bg-neutral-950/80 p-4 sm:p-5">
                <Field icon={<UserRound size={18} />} label="Ім’я Директора">
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                    className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    placeholder="Наприклад: Олександр"
                  />
                </Field>

                <Field icon={<UserRound size={18} />} label="Ім’я для входу">
                  <input
                    value={loginName}
                    onChange={(event) => setLoginName(event.target.value.replace(/\s/g, ''))}
                    autoComplete="username"
                    className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    placeholder="Наприклад: director"
                  />
                </Field>

                {configured && (
                  <Field icon={<KeyRound size={18} />} label="Поточний пароль">
                    <input
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    />
                  </Field>
                )}

                <Field icon={<LockKeyhole size={18} />} label="Новий пароль">
                  <input
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    placeholder="Не менше 6 символів"
                  />
                </Field>

                <Field icon={<LockKeyhole size={18} />} label="Повторіть новий пароль">
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                  />
                </Field>

                <button
                  type="button"
                  onClick={() => setShowPasswords((value) => !value)}
                  className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs font-bold text-white/55"
                >
                  {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showPasswords ? 'Приховати паролі' : 'Показати паролі'}
                </button>

                <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-3 text-xs text-emerald-50/70">
                  Пароль зберігається тільки як захищений хеш. Після першого збереження PIN 1111 більше не приймається.
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-200/50 bg-amber-300/15 px-4 py-4 font-black text-amber-50 shadow-[0_0_28px_rgba(251,191,36,.11)] disabled:opacity-40"
                >
                  {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}
                  Зберегти дані входу
                </button>
              </section>
            )}
          </main>
        </div>
      )}
    </>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="text-xs font-bold text-white/45">{label}</span>
      <span className="mt-2 flex items-center rounded-2xl border border-white/10 bg-black/40 pl-4 focus-within:border-amber-200/40">
        <span className="text-white/30">{icon}</span>
        {children}
      </span>
    </label>
  );
}
