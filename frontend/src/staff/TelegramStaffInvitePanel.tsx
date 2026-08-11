import { useEffect, useMemo, useState } from 'react';

import { staffApi, type StaffMember, type StaffRole } from '../api/staff';

type Props = {
  audience: 'admin' | 'director';
};

function roleLabel(role: StaffRole) {
  if (role === 'owner') return 'Директор';
  if (role === 'admin') return 'Адміністратор';
  if (role === 'hookah') return 'Кальянник';
  return 'Офіціант';
}

export default function TelegramStaffInvitePanel({ audience }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
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
        Створіть одноразове посилання та надішліть його конкретному працівнику.
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
