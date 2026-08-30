import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { staffApi, type StaffMember, type StaffRole } from '../api/staff';

type Props = {
  audience: 'admin' | 'director';
};

type AdminForm = {
  fullName: string;
  phone: string;
  pin: string;
  note: string;
};

const EMPTY_ADMIN_FORM: AdminForm = {
  fullName: '',
  phone: '',
  pin: '',
  note: '',
};

function roleLabel(role: StaffRole) {
  if (role === 'owner') return 'Директор';
  if (role === 'admin') return 'Адміністратор';
  if (role === 'hookah') return 'Кальянник';
  return 'Офіціант';
}

export default function TelegramStaffInvitePanel({ audience }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [adminForm, setAdminForm] = useState<AdminForm>(EMPTY_ADMIN_FORM);
  const [loading, setLoading] = useState(true);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await staffApi.getAll();
        if (!cancelled) setStaff(result);
      } catch (cause: any) {
        if (!cancelled) {
          setError(cause?.message || 'Не вдалося завантажити працівників');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleStaff = useMemo(
    () =>
      staff
        .filter((member) => member.active && !member.isArchived)
        .filter((member) =>
          audience === 'admin'
            ? member.role === 'waiter' || member.role === 'hookah'
            : true,
        )
        .sort((left, right) => left.fullName.localeCompare(right.fullName, 'uk')),
    [audience, staff],
  );

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const fullName = adminForm.fullName.trim();
    const pin = adminForm.pin.trim();

    if (!fullName) {
      setError('Вкажіть ім’я Адміністратора');
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN має містити від 4 до 6 цифр');
      return;
    }

    try {
      setCreatingAdmin(true);
      setError(null);
      setNotice(null);
      const created = await staffApi.create({
        fullName,
        role: 'admin',
        pin,
        ...(adminForm.phone.trim() ? { phone: adminForm.phone.trim() } : {}),
        ...(adminForm.note.trim() ? { note: adminForm.note.trim() } : {}),
      });
      setStaff((current) => [created, ...current.filter((member) => member.id !== created.id)]);
      setAdminForm(EMPTY_ADMIN_FORM);
      setNotice(`Адміністратора ${created.fullName} додано. Тепер прив’яжіть Telegram нижче.`);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося додати Адміністратора');
    } finally {
      setCreatingAdmin(false);
    }
  }

  async function createInvite(member: StaffMember) {
    try {
      setBusyId(member.id);
      setError(null);
      setNotice(null);
      const result = await staffApi.createTelegramInvite(member.id);
      setLinks((current) => ({ ...current, [member.id]: result.inviteUrl }));

      try {
        await navigator.clipboard.writeText(result.inviteUrl);
        setNotice(`Посилання для ${member.fullName} скопійовано`);
      } catch {
        setNotice(`Посилання для ${member.fullName} створено`);
      }
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося створити Telegram-посилання');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-4 rounded-[28px] border border-sky-300/20 bg-sky-400/[0.05] p-4 shadow-[0_0_30px_rgba(56,189,248,.06)]">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-200/60">
        Telegram персоналу
      </p>
      <h2 className="mt-1 text-xl font-black text-white">Прив’язка робочого акаунта</h2>
      <p className="mt-2 text-sm text-white/50">
        Створіть одноразове посилання та надішліть його конкретному працівнику. Посилання діє 30 хвилин.
      </p>

      {error && (
        <div className="mt-3 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {notice && (
        <div className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      {audience === 'director' && (
        <form
          onSubmit={createAdmin}
          className="mt-4 rounded-[24px] border border-amber-200/20 bg-amber-300/[0.05] p-4"
        >
          <h3 className="text-lg font-black text-white">Додати Адміністратора</h3>
          <p className="mt-1 text-xs text-white/45">
            Директор створює обліковий запис Адміністратора. Після створення прив’яжіть його Telegram нижче.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-white/70">
              Ім’я
              <input
                value={adminForm.fullName}
                onChange={(event) => setAdminForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Ім’я та прізвище"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
              />
            </label>

            <label className="text-sm font-bold text-white/70">
              Телефон
              <input
                value={adminForm.phone}
                onChange={(event) => setAdminForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Необов’язково"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
              />
            </label>

            <label className="text-sm font-bold text-white/70">
              PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={adminForm.pin}
                onChange={(event) => setAdminForm((current) => ({
                  ...current,
                  pin: event.target.value.replace(/\D/g, '').slice(0, 6),
                }))}
                pattern="\d{4,6}"
                maxLength={6}
                placeholder="4–6 цифр"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-center text-xl font-black tracking-[0.28em] text-white outline-none focus:border-amber-300/50"
              />
            </label>

            <label className="text-sm font-bold text-white/70 sm:col-span-2">
              Примітка
              <textarea
                value={adminForm.note}
                onChange={(event) => setAdminForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Необов’язково"
                className="mt-2 min-h-20 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-amber-300/50"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={creatingAdmin}
            className="mt-4 w-full rounded-2xl border border-amber-200/35 bg-amber-300/10 px-4 py-3 font-black text-amber-100 disabled:opacity-40"
          >
            {creatingAdmin ? 'Додаємо…' : 'Додати Адміністратора'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-white/45">Завантаження персоналу…</p>
      ) : (
        <div className="mt-4 space-y-2">
          {visibleStaff.map((member) => {
            const inviteUrl = links[member.id];
            const linked = Boolean(member.telegramId);

            return (
              <article
                key={member.id}
                className="rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-black text-white">{member.fullName}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {roleLabel(member.role)} · {linked ? 'Telegram прив’язаний' : 'Telegram не прив’язаний'}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={linked || busyId === member.id}
                    onClick={() => void createInvite(member)}
                    className="rounded-xl border border-sky-200/30 bg-sky-300/10 px-3 py-2 text-xs font-black text-sky-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30"
                  >
                    {linked
                      ? 'Прив’язано'
                      : busyId === member.id
                        ? 'Створюємо…'
                        : 'Прив’язати Telegram'}
                  </button>
                </div>

                {inviteUrl && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/45 p-2">
                    <p className="mb-1 text-[11px] font-bold text-white/40">
                      Надішліть це посилання працівнику. Воно спрацює один раз.
                    </p>
                    <input
                      readOnly
                      value={inviteUrl}
                      onFocus={(event) => event.currentTarget.select()}
                      className="w-full bg-transparent text-xs text-sky-100 outline-none"
                    />
                  </div>
                )}
              </article>
            );
          })}

          {!visibleStaff.length && (
            <p className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-white/40">
              Активних працівників немає.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
