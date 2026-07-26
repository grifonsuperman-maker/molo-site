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

const OPEN_EVENT = 'molo:open-director-access';

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
    setError(null);
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
    const openSettings = () => {
      setOpen(true);
      setError(null);
      setNotice(null);
      void load();
    };
    window.addEventListener(OPEN_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_EVENT, openSettings);
  }, []);

  async function save() {
    const cleanName = fullName.trim();
    const cleanLogin = loginName.trim();
    const changesPassword = Boolean(newPassword || confirmPassword);

    if (!cleanName) return setError('Вкажіть ім’я Директора');
    if (cleanLogin.length < 3) return setError('Логін має містити щонайменше 3 символи');
    if (/\s/.test(cleanLogin)) return setError('Логін не повинен містити пробілів');
    if (configured && !currentPassword) return setError('Для збереження введіть поточний пароль');
    if (!configured && newPassword.length < 6) return setError('Створіть пароль щонайменше з 6 символів');
    if (changesPassword && newPassword.length < 6) return setError('Новий пароль має містити щонайменше 6 символів');
    if (changesPassword && newPassword !== confirmPassword) return setError('Новий пароль і підтвердження не збігаються');

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      // Backend expects a password on every update. When only the login/name changes,
      // reusing the verified current password keeps the password unchanged for the user.
      const passwordToSave = configured && !changesPassword ? currentPassword : newPassword;
      const value = await staffApi.updateDirectorAccess({
        fullName: cleanName,
        loginName: cleanLogin,
        currentPassword: configured ? currentPassword : undefined,
        newPassword: passwordToSave,
        confirmPassword: passwordToSave,
      });

      setConfigured(value.configured);
      setFullName(value.fullName);
      setLoginName(value.loginName);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice(
        configured
          ? changesPassword
            ? 'Логін, ім’я та пароль збережено.'
            : 'Ім’я та логін збережено. Пароль не змінено.'
          : 'Дані входу створено. Тимчасовий PIN 1111 вимкнено.',
      );
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося зберегти дані входу');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-black/85 p-3 text-white backdrop-blur-2xl">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,.1),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(52,211,153,.065),transparent_40%)]" />
      <main className="relative mx-auto min-h-[calc(100dvh-24px)] max-w-2xl rounded-[32px] border border-amber-100/25 bg-[#050505]/95 p-4 shadow-[0_0_80px_rgba(251,191,36,.1)] sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-100/35 bg-black/50 text-amber-100 shadow-[0_0_26px_rgba(251,191,36,.1)]">
              <ShieldCheck size={27} className="drop-shadow-[0_0_9px_rgba(253,230,138,.75)]" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/45">MOLO · Директор</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Налаштування входу</h1>
            </div>
          </div>
          {configured && (
            <button type="button" aria-label="Закрити" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/12 bg-black/45 text-white/60">
              <X size={19} />
            </button>
          )}
        </header>

        {!configured && (
          <div className="mt-5 rounded-2xl border border-rose-200/30 bg-black/40 p-4 text-sm leading-6 text-rose-50/80 shadow-[0_0_24px_rgba(244,63,94,.07)]">
            Ви увійшли за тимчасовим PIN <strong>1111</strong>. Створіть власний логін і пароль. До збереження це вікно не закривається.
          </div>
        )}

        {(error || notice) && (
          <div className={`mt-4 rounded-2xl border bg-black/45 p-3 text-sm ${error ? 'border-rose-300/35 text-rose-100' : 'border-emerald-200/35 text-emerald-100'}`}>
            {error || notice}
          </div>
        )}

        {loading ? (
          <div className="grid min-h-72 place-items-center"><LoaderCircle className="animate-spin text-amber-200" size={28} /></div>
        ) : (
          <section className="mt-5 rounded-[28px] border border-white/10 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] sm:p-5">
            <Field icon={<UserRound size={18} />} label="Ім’я Директора" hint="Відображається в команді та історії">
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="Наприклад: Олександр" />
            </Field>

            <Field icon={<UserRound size={18} />} label="Логін для входу" hint="Можна змінювати окремо від пароля">
              <input value={loginName} onChange={(event) => setLoginName(event.target.value.replace(/\s/g, ''))} autoComplete="username" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="Наприклад: director" />
            </Field>

            {configured && (
              <Field icon={<KeyRound size={18} />} label="Поточний пароль" hint="Потрібен для будь-якого збереження">
                <input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type={showPasswords ? 'text' : 'password'} autoComplete="current-password" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
              </Field>
            )}

            <div className="mt-5 border-t border-white/10 pt-1">
              <p className="mt-3 text-xs font-black uppercase tracking-[0.18em] text-white/35">{configured ? 'Зміна пароля — необов’язково' : 'Створіть постійний пароль'}</p>
              <Field icon={<LockKeyhole size={18} />} label="Новий пароль" hint={configured ? 'Залиште порожнім, щоб пароль не змінювався' : 'Не менше 6 символів'}>
                <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type={showPasswords ? 'text' : 'password'} autoComplete="new-password" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder={configured ? 'Не змінювати' : 'Не менше 6 символів'} />
              </Field>
              <Field icon={<LockKeyhole size={18} />} label="Повторіть новий пароль">
                <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type={showPasswords ? 'text' : 'password'} autoComplete="new-password" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
              </Field>
            </div>

            <button type="button" onClick={() => setShowPasswords((value) => !value)} className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2.5 text-xs font-bold text-white/55">
              {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}{showPasswords ? 'Приховати паролі' : 'Показати паролі'}
            </button>

            <div className="mt-4 rounded-2xl border border-emerald-200/20 bg-black/35 p-3 text-xs leading-5 text-emerald-50/65">
              Ім’я, логін і пароль — окремі дані. Можна змінити тільки логін, не змінюючи пароль. Пароль зберігається лише як захищений хеш.
            </div>

            <button type="button" disabled={busy} onClick={() => void save()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/50 bg-black/40 px-4 py-4 font-black text-amber-50 shadow-[0_0_28px_rgba(251,191,36,.1)] transition active:scale-[.99] disabled:opacity-40">
              {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}
              Зберегти дані входу
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function Field({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="flex items-end justify-between gap-3"><span className="text-xs font-bold text-white/55">{label}</span>{hint && <span className="text-right text-[10px] text-white/28">{hint}</span>}</span>
      <span className="mt-2 flex items-center rounded-2xl border border-white/12 bg-black/45 pl-4 focus-within:border-amber-100/40 focus-within:shadow-[0_0_20px_rgba(251,191,36,.06)]">
        <span className="text-white/30">{icon}</span>{children}
      </span>
    </label>
  );
}
