import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import {
  staffApi,
  type CreateStaffPayload,
  type StaffMember,
  type StaffRole,
} from '../api/staff';

type StaffForm = {
  fullName: string;
  phone: string;
  role: Extract<StaffRole, 'waiter' | 'hookah'>;
  pin: string;
  note: string;
};

const EMPTY_FORM: StaffForm = {
  fullName: '',
  phone: '',
  role: 'waiter',
  pin: '',
  note: '',
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

function roleLabel(role: StaffRole) {
  if (role === 'waiter') return 'Офіціант';
  if (role === 'hookah') return 'Кальянник';
  if (role === 'admin') return 'Адміністратор';
  return 'Власник';
}

function formatDateTime(value: string | null) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminStaffPanel() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleStaff = useMemo(
    () =>
      staff
        .filter((item) => item.role === 'waiter' || item.role === 'hookah')
        .filter((item) => (showArchived ? item.isArchived : !item.isArchived))
        .sort((a, b) => {
          if (a.role !== b.role) return a.role.localeCompare(b.role);
          return a.fullName.localeCompare(b.fullName, 'uk');
        }),
    [showArchived, staff],
  );

  const loadStaff = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      setStaff(await staffApi.getAll());
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function createStaffMember(event: FormEvent) {
    event.preventDefault();

    const fullName = form.fullName.trim();
    const pin = form.pin.trim();

    if (!fullName) {
      setError('Вкажіть ім’я працівника');
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN має містити від 4 до 6 цифр');
      return;
    }

    const payload: CreateStaffPayload = {
      fullName,
      role: form.role,
      pin,
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    };

    try {
      setCreating(true);
      setError(null);
      const created = await staffApi.create(payload);
      setStaff((current) => [created, ...current]);
      setForm(EMPTY_FORM);
      setMessage(`${roleLabel(created.role)} доданий`);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setCreating(false);
    }
  }

  async function runAction(
    member: StaffMember,
    action: () => Promise<StaffMember>,
    successText: string,
  ) {
    try {
      setBusyId(member.id);
      setError(null);
      const updated = await action();
      setStaff((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMessage(successText);
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusyId(null);
    }
  }

  async function changePin(member: StaffMember) {
    const pin = window.prompt(`Новий PIN для ${member.fullName}:`, '');
    if (pin === null) return;

    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN має містити від 4 до 6 цифр');
      return;
    }

    await runAction(
      member,
      () => staffApi.update(member.id, { pin }),
      `PIN для ${member.fullName} змінено`,
    );
  }

  async function archiveMember(member: StaffMember) {
    if (!window.confirm(`Перемістити ${member.fullName} в архів?`)) return;

    await runAction(
      member,
      () => staffApi.archive(member.id),
      `${member.fullName} переміщено в архів`,
    );
  }

  return (
    <section className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200/60">
          Керування командою
        </p>
        <h2 className="mt-1 text-2xl font-black text-white">Персонал</h2>
        <p className="mt-2 text-sm text-white/55">
          Додавайте офіціантів і кальянників, задавайте PIN та керуйте змінами.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {message}
        </div>
      )}

      <form onSubmit={createStaffMember} className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
        <h3 className="text-lg font-black text-white">Додати працівника</h3>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-white/70">
            Ім’я
            <input
              value={form.fullName}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
              placeholder="Ім’я та прізвище"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
            />
          </label>

          <label className="text-sm font-bold text-white/70">
            Посада
            <select
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as StaffForm['role'] }))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
            >
              <option value="waiter">Офіціант</option>
              <option value="hookah">Кальянник</option>
            </select>
          </label>

          <label className="text-sm font-bold text-white/70">
            Телефон
            <input
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+380…"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
            />
          </label>

          <label className="text-sm font-bold text-white/70">
            PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={form.pin}
              onChange={(event) => setForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
              placeholder="4–6 цифр"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-center text-xl font-black tracking-[0.28em] text-white outline-none focus:border-amber-300/50"
            />
          </label>
        </div>

        <label className="mt-3 block text-sm font-bold text-white/70">
          Примітка
          <textarea
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="Необов’язково"
            className="mt-2 min-h-20 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
          />
        </label>

        <button type="submit" disabled={creating} className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-neutral-950 transition active:scale-[0.98] disabled:opacity-40">
          {creating ? 'Додаємо…' : 'Додати працівника'}
        </button>
      </form>

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-black text-white">{showArchived ? 'Архів персоналу' : 'Активний персонал'}</h3>
        <button type="button" onClick={() => setShowArchived((current) => !current)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/65">
          {showArchived ? 'Показати активних' : 'Показати архів'}
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-white/55">Завантаження персоналу…</div>
      ) : visibleStaff.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-center text-sm text-white/55">
          {showArchived ? 'Архів порожній' : 'Працівників ще немає'}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleStaff.map((member) => {
            const busy = busyId === member.id;
            return (
              <article key={member.id} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-lg font-black text-white">{member.fullName}</h4>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/65">{roleLabel(member.role)}</span>
                    </div>
                    <p className="mt-1 text-sm text-white/50">{member.phone || 'Телефон не вказано'}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${member.isOnShift ? 'bg-emerald-300/15 text-emerald-100' : 'bg-white/5 text-white/45'}`}>
                    {member.isOnShift ? 'На зміні' : 'Не на зміні'}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-white/50 sm:grid-cols-2">
                  <p>PIN: {member.hasPin ? 'встановлено' : 'не встановлено'}</p>
                  <p>Початок зміни: {formatDateTime(member.shiftStartedAt)}</p>
                </div>

                {!member.isArchived && (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => void runAction(member, () => member.isOnShift ? staffApi.endShift(member.id) : staffApi.startShift(member.id), member.isOnShift ? `Зміну ${member.fullName} закрито` : `Зміну ${member.fullName} відкрито`)}
                      disabled={busy || !member.active}
                      className="rounded-xl border border-emerald-200/25 bg-emerald-300/10 px-3 py-2 text-xs font-black text-emerald-100 disabled:opacity-40"
                    >
                      {member.isOnShift ? 'Закрити зміну' : 'Відкрити зміну'}
                    </button>

                    <button type="button" onClick={() => void changePin(member)} disabled={busy} className="rounded-xl border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 disabled:opacity-40">Змінити PIN</button>

                    <button
                      type="button"
                      onClick={() => void runAction(member, () => member.active ? staffApi.block(member.id) : staffApi.unblock(member.id), member.active ? `${member.fullName} заблокований` : `${member.fullName} розблокований`)}
                      disabled={busy || member.isOnShift}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/65 disabled:opacity-40"
                    >
                      {member.active ? 'Заблокувати' : 'Розблокувати'}
                    </button>

                    <button type="button" onClick={() => void archiveMember(member)} disabled={busy || member.isOnShift} className="rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100 disabled:opacity-40">В архів</button>
                  </div>
                )}

                {member.isArchived && (
                  <button type="button" onClick={() => void runAction(member, () => staffApi.restore(member.id), `${member.fullName} відновлений`)} disabled={busy} className="mt-4 w-full rounded-xl border border-emerald-200/25 bg-emerald-300/10 px-3 py-2 text-xs font-black text-emerald-100 disabled:opacity-40">Відновити</button>
                )}
              </article>
            );
          })}
        </div>
      )}

      <button type="button" onClick={() => void loadStaff()} disabled={loading} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/65 disabled:opacity-40">Оновити список</button>
    </section>
  );
}
