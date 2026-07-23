import { useEffect, useMemo, useState } from 'react';
import { Clock3, RefreshCw, UserRoundCheck } from 'lucide-react';

import { staffApi } from '../api/staff';
import type { StaffMember } from '../api/staff';

function roleLabel(role: StaffMember['role']) {
  if (role === 'waiter') return 'Офіціант';
  if (role === 'hookah') return 'Кальянник';
  if (role === 'admin') return 'Адміністратор';
  return 'Директор';
}

function timeLabel(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminShiftPanel() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setStaff(await staffApi.getAll());
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося завантажити персонал');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => staff
      .filter((member) => !member.isArchived && member.active)
      .filter((member) => member.role === 'waiter' || member.role === 'hookah')
      .sort((left, right) => left.role.localeCompare(right.role) || left.fullName.localeCompare(right.fullName, 'uk')),
    [staff],
  );

  async function changeShift(member: StaffMember) {
    setBusyId(member.id);
    setError(null);
    try {
      const updated = member.isOnShift
        ? await staffApi.endShift(member.id, { performedBy: 'Адміністратор' })
        : await staffApi.startShift(member.id, { performedBy: 'Адміністратор' });
      setStaff((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(updated.isOnShift ? `${updated.fullName} на зміні` : `Зміну ${updated.fullName} завершено`);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити зміну');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-neutral-950 p-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-100/50">Дозволено Директором</p>
          <h1 className="mt-1 text-2xl font-black">Зміни персоналу</h1>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/60 disabled:opacity-40">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      {(notice || error) && <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'}`}>{error || notice}</div>}

      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((member) => (
          <article key={member.id} className={`rounded-[22px] border p-4 ${member.isOnShift ? 'border-emerald-300/30 bg-emerald-400/[0.07]' : 'border-white/10 bg-neutral-950'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">{member.fullName}</p>
                <p className="mt-1 text-xs text-white/40">{roleLabel(member.role)}</p>
              </div>
              <span className={`grid h-11 w-11 place-items-center rounded-2xl border ${member.isOnShift ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-white/35'}`}>
                <UserRoundCheck size={20} />
              </span>
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs text-white/45"><Clock3 size={14} />{member.isOnShift ? `На зміні з ${timeLabel(member.shiftStartedAt)}` : 'Не на зміні'}</p>
            <button type="button" disabled={busyId === member.id} onClick={() => void changeShift(member)} className={`mt-3 w-full rounded-2xl border px-3 py-3 text-sm font-black disabled:opacity-40 ${member.isOnShift ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'}`}>
              {member.isOnShift ? 'Завершити зміну' : 'Почати зміну'}
            </button>
          </article>
        ))}
      </div>

      {!visible.length && <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/35">Активних офіціантів і кальянників немає.</div>}
    </section>
  );
}
