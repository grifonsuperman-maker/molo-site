import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BadgePlus,
  BriefcaseBusiness,
  Check,
  LoaderCircle,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Square,
  UserCog,
  X,
} from 'lucide-react';

import { staffApi, type StaffMember, type StaffRole } from '../api/staff';

type EditableRole = Exclude<StaffRole, 'owner'>;
type ConfirmAction = { kind: 'archive' | 'restore'; member: StaffMember } | null;
type EditorState = {
  id: string | null;
  fullName: string;
  phone: string;
  role: EditableRole;
  pin: string;
  note: string;
};

const TAB_STORAGE_KEY = 'molo:director:active-tab';
const EMPTY_EDITOR: EditorState = {
  id: null,
  fullName: '',
  phone: '',
  role: 'waiter',
  pin: '',
  note: '',
};

function roleLabel(role: StaffRole): string {
  if (role === 'owner') return 'Директор';
  if (role === 'admin') return 'Адміністратор';
  if (role === 'waiter') return 'Офіціант';
  return 'Кальянник';
}

function canUseShift(role: StaffRole): boolean {
  return role === 'waiter' || role === 'hookah';
}

export default function DirectorTeamManagementDock() {
  const [teamTabActive, setTeamTabActive] = useState(
    () => window.sessionStorage.getItem(TAB_STORAGE_KEY) === 'team',
  );
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncTab = () => {
      window.setTimeout(() => {
        setTeamTabActive(window.sessionStorage.getItem(TAB_STORAGE_KEY) === 'team');
      }, 0);
    };

    window.addEventListener('click', syncTab, true);
    window.addEventListener('focus', syncTab);
    return () => {
      window.removeEventListener('click', syncTab, true);
      window.removeEventListener('focus', syncTab);
    };
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setStaff(await staffApi.getAll());
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося завантажити команду');
    } finally {
      setLoading(false);
    }
  }

  function openManager() {
    setOpen(true);
    setEditor(null);
    setNotice(null);
    setError(null);
    void load();
  }

  const activeStaff = useMemo(
    () => staff.filter((member) => !member.isArchived && member.role !== 'owner'),
    [staff],
  );
  const archivedStaff = useMemo(
    () => staff.filter((member) => member.isArchived && member.role !== 'owner'),
    [staff],
  );
  const director = useMemo(
    () => staff.find((member) => member.role === 'owner' && !member.isArchived),
    [staff],
  );

  function beginCreate(role: EditableRole = 'waiter') {
    setEditor({ ...EMPTY_EDITOR, role });
    setNotice(null);
    setError(null);
  }

  function beginEdit(member: StaffMember) {
    if (member.role === 'owner') return;
    setEditor({
      id: member.id,
      fullName: member.fullName,
      phone: member.phone || '',
      role: member.role,
      pin: '',
      note: member.note || '',
    });
    setNotice(null);
    setError(null);
  }

  function replaceMember(updated: StaffMember) {
    setStaff((current) => {
      const exists = current.some((member) => member.id === updated.id);
      return exists
        ? current.map((member) => (member.id === updated.id ? updated : member))
        : [...current, updated];
    });
  }

  async function saveEditor() {
    if (!editor) return;
    const fullName = editor.fullName.trim();
    const phone = editor.phone.trim();
    const pin = editor.pin.trim();
    const note = editor.note.trim();

    if (fullName.length < 2) return setError('Вкажіть ім’я працівника');
    if (!editor.id && !/^\d{6}$/.test(pin)) {
      return setError('Для нового працівника потрібен шестизначний PIN');
    }
    if (editor.id && pin && !/^\d{6}$/.test(pin)) {
      return setError('Новий PIN має містити рівно 6 цифр');
    }

    setBusy(editor.id ? `save:${editor.id}` : 'create');
    setError(null);
    setNotice(null);

    try {
      let updated: StaffMember;
      if (editor.id) {
        const previous = staff.find((member) => member.id === editor.id);
        if (previous?.isOnShift && editor.role === 'admin') {
          await staffApi.endShift(editor.id, {
            performedBy: 'Директор',
            comment: 'Зміну завершено перед переведенням в Адміністратори',
          });
        }
        updated = await staffApi.update(editor.id, {
          fullName,
          phone: phone || undefined,
          role: editor.role,
          note: note || undefined,
          ...(pin ? { pin } : {}),
        });
        setNotice(`Дані «${updated.fullName}» оновлено`);
      } else {
        updated = await staffApi.create({
          fullName,
          phone: phone || undefined,
          role: editor.role,
          pin,
          note: note || undefined,
        });
        setNotice(`${roleLabel(updated.role)} «${updated.fullName}» доданий до команди`);
      }
      replaceMember(updated);
      setEditor(null);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося зберегти працівника');
    } finally {
      setBusy(null);
    }
  }

  async function toggleShift(member: StaffMember) {
    if (!canUseShift(member.role)) return;
    setBusy(`shift:${member.id}`);
    setError(null);
    try {
      const updated = member.isOnShift
        ? await staffApi.endShift(member.id, {
            performedBy: 'Директор',
            comment: 'Зміну завершено з Пульта Директора',
          })
        : await staffApi.startShift(member.id, {
            performedBy: 'Директор',
            comment: 'Додано на зміну з Пульта Директора',
          });
      replaceMember(updated);
      setNotice(
        updated.isOnShift
          ? `«${updated.fullName}» додано на зміну`
          : `Зміну «${updated.fullName}» завершено`,
      );
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити статус зміни');
    } finally {
      setBusy(null);
    }
  }

  async function applyConfirm() {
    if (!confirmAction) return;
    const { member, kind } = confirmAction;
    setBusy(`${kind}:${member.id}`);
    setError(null);
    try {
      const updated = kind === 'archive'
        ? await staffApi.archive(member.id, {
            performedBy: 'Директор',
            comment: 'Видалено з активної команди у Пульті Директора',
          })
        : await staffApi.restore(member.id, {
            performedBy: 'Директор',
            comment: 'Відновлено у Пульті Директора',
          });
      replaceMember(updated);
      setNotice(
        kind === 'archive'
          ? `«${updated.fullName}» перенесено до архіву`
          : `«${updated.fullName}» повернуто до команди`,
      );
      setConfirmAction(null);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося виконати дію');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {teamTabActive && !open && (
        <button
          type="button"
          onClick={openManager}
          className="fixed bottom-24 right-3 z-50 flex items-center gap-2 rounded-2xl border border-amber-100/50 bg-black/85 px-4 py-3 text-sm font-black text-amber-50 shadow-[0_0_30px_rgba(251,191,36,.18),inset_0_0_18px_rgba(251,191,36,.04)] backdrop-blur-2xl transition active:scale-95 sm:right-5"
        >
          <UserCog size={18} className="drop-shadow-[0_0_8px_rgba(253,230,138,.9)]" />
          Керування командою
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[110] overflow-y-auto bg-[#020302]/96 p-3 text-white backdrop-blur-2xl">
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(52,211,153,.1),transparent_34%),radial-gradient(circle_at_90%_8%,rgba(251,191,36,.11),transparent_32%)]" />
          <main className="relative mx-auto min-h-[calc(100dvh-24px)] max-w-5xl rounded-[30px] border border-amber-100/20 bg-black/70 p-4 shadow-[0_0_65px_rgba(251,191,36,.08)] sm:p-6">
            <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-100/50">MOLO · Директор</p>
                <h1 className="mt-1 text-2xl font-black sm:text-3xl">Керування командою</h1>
                <p className="mt-2 text-sm text-white/45">Додавання, редагування, ролі, PIN, зміни та архів.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/50 text-white/70">
                <X size={19} />
              </button>
            </header>

            {(notice || error) && (
              <div className={`mt-4 rounded-2xl border bg-black/50 px-4 py-3 text-sm ${error ? 'border-rose-300/35 text-rose-100' : 'border-emerald-200/35 text-emerald-100'}`}>
                {error || notice}
              </div>
            )}

            {editor ? (
              <section className="mt-4 rounded-[24px] border border-amber-100/25 bg-black/45 p-4 shadow-[0_0_32px_rgba(251,191,36,.06)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">{editor.id ? 'Редагування' : 'Новий доступ'}</p>
                    <h2 className="mt-1 text-xl font-black">{editor.id ? 'Змінити працівника' : 'Додати до команди'}</h2>
                  </div>
                  <button type="button" onClick={() => setEditor(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/12 text-white/55"><X size={17} /></button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Ім’я та прізвище">
                    <input value={editor.fullName} onChange={(event) => setEditor({ ...editor, fullName: event.target.value })} className="input" placeholder="Наприклад: Олександр" />
                  </Field>
                  <Field label="Роль">
                    <select value={editor.role} onChange={(event) => setEditor({ ...editor, role: event.target.value as EditableRole })} className="input [color-scheme:dark]">
                      <option value="admin">Адміністратор</option>
                      <option value="waiter">Офіціант</option>
                      <option value="hookah">Кальянник</option>
                    </select>
                  </Field>
                  <Field label="Телефон">
                    <input value={editor.phone} onChange={(event) => setEditor({ ...editor, phone: event.target.value })} className="input" inputMode="tel" placeholder="Необов’язково" />
                  </Field>
                  <Field label={editor.id ? 'Новий PIN — залиште порожнім, щоб не міняти' : 'Особистий PIN'}>
                    <input value={editor.pin} onChange={(event) => setEditor({ ...editor, pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="input tracking-[0.24em]" inputMode="numeric" type="password" placeholder="6 цифр" />
                  </Field>
                </div>
                <Field label="Примітка">
                  <textarea value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} className="input min-h-24 resize-none py-3" placeholder="Необов’язково" />
                </Field>

                <button type="button" onClick={() => void saveEditor()} disabled={Boolean(busy)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/50 bg-black/55 px-4 py-3.5 font-black text-amber-50 shadow-[0_0_24px_rgba(251,191,36,.12)] disabled:opacity-40">
                  {busy ? <LoaderCircle size={18} className="animate-spin" /> : editor.id ? <Save size={18} /> : <BadgePlus size={18} />}
                  {editor.id ? 'Зберегти зміни' : 'Додати працівника'}
                </button>
              </section>
            ) : (
              <>
                <section className="mt-4 grid gap-2 sm:grid-cols-3">
                  <QuickAdd label="Додати Адміністратора" onClick={() => beginCreate('admin')} />
                  <QuickAdd label="Додати Офіціанта" onClick={() => beginCreate('waiter')} />
                  <QuickAdd label="Додати Кальянника" onClick={() => beginCreate('hookah')} />
                </section>

                {director && (
                  <section className="mt-4 rounded-2xl border border-amber-100/18 bg-black/35 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-100/40">Директор</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div><p className="font-black">{director.fullName}</p><p className="mt-1 text-xs text-white/40">Ім’я, логін і пароль змінюються у «Налаштуваннях входу».</p></div>
                      <BriefcaseBusiness size={19} className="text-amber-100/55" />
                    </div>
                  </section>
                )}

                <section className="mt-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100/45">Активна команда</p><h2 className="mt-1 text-xl font-black">Адміністратори та персонал</h2></div><button type="button" onClick={() => void load()} className="rounded-xl border border-white/12 px-3 py-2 text-xs font-bold text-white/55">Оновити</button></div>
                  {loading ? <div className="grid min-h-44 place-items-center"><LoaderCircle className="animate-spin text-amber-100" /></div> : (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {activeStaff.map((member) => (
                        <article key={member.id} className="rounded-[22px] border border-white/12 bg-black/40 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="font-black">{member.fullName}</p><p className="mt-1 text-xs text-white/40">{roleLabel(member.role)}{member.phone ? ` · ${member.phone}` : ''}</p></div>
                            <span className={`h-2.5 w-2.5 rounded-full ${member.isOnShift ? 'bg-emerald-300 shadow-[0_0_13px_rgba(110,231,183,.9)]' : 'bg-white/20'}`} />
                          </div>
                          <p className="mt-3 text-xs text-white/45">{member.isOnShift ? 'Зараз на зміні' : canUseShift(member.role) ? 'Не на зміні' : 'Вхід за особистим PIN'}</p>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <SmallAction label="Змінити" icon={<Pencil size={15} />} onClick={() => beginEdit(member)} />
                            {canUseShift(member.role) ? <SmallAction label={member.isOnShift ? 'Завершити зміну' : 'Додати на зміну'} icon={member.isOnShift ? <Square size={14} /> : <Play size={15} />} onClick={() => void toggleShift(member)} disabled={busy === `shift:${member.id}`} /> : <SmallAction label="Змінити роль" icon={<UserCog size={15} />} onClick={() => beginEdit(member)} />}
                            <button type="button" onClick={() => setConfirmAction({ kind: 'archive', member })} className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-black/35 px-3 py-2.5 text-xs font-black text-rose-100"><Archive size={15} />Видалити до архіву</button>
                          </div>
                        </article>
                      ))}
                      {!activeStaff.length && <div className="rounded-2xl border border-dashed border-white/12 p-6 text-center text-sm text-white/35 md:col-span-2">Працівників ще немає</div>}
                    </div>
                  )}
                </section>

                {archivedStaff.length > 0 && (
                  <section className="mt-5 border-t border-white/10 pt-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">Архів</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {archivedStaff.map((member) => (
                        <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div><p className="text-sm font-black">{member.fullName}</p><p className="mt-1 text-xs text-white/35">{roleLabel(member.role)}</p></div>
                          <button type="button" onClick={() => setConfirmAction({ kind: 'restore', member })} className="flex items-center gap-2 rounded-xl border border-emerald-200/30 px-3 py-2 text-xs font-black text-emerald-100"><RotateCcw size={15} />Відновити</button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black/85 p-4 text-white backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[26px] border border-amber-100/25 bg-[#070807] p-5 shadow-[0_0_50px_rgba(251,191,36,.08)]">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">Підтвердження</p>
            <h2 className="mt-2 text-xl font-black">{confirmAction.kind === 'archive' ? 'Видалити працівника?' : 'Відновити працівника?'}</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">«{confirmAction.member.fullName}» {confirmAction.kind === 'archive' ? 'зникне з активної команди, але історія збережеться.' : 'знову з’явиться в активній команді.'}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmAction(null)} className="rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-sm font-black text-white/65">Скасувати</button>
              <button type="button" onClick={() => void applyConfirm()} disabled={Boolean(busy)} className={`rounded-2xl border bg-black/40 px-4 py-3 text-sm font-black disabled:opacity-40 ${confirmAction.kind === 'archive' ? 'border-rose-300/40 text-rose-100' : 'border-emerald-200/40 text-emerald-100'}`}>{busy ? 'Зачекайте…' : confirmAction.kind === 'archive' ? 'Видалити' : 'Відновити'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-3 block"><span className="text-xs font-bold text-white/45">{label}</span><span className="mt-2 block [&_.input]:w-full [&_.input]:rounded-2xl [&_.input]:border [&_.input]:border-white/12 [&_.input]:bg-black/45 [&_.input]:px-4 [&_.input]:py-3 [&_.input]:text-sm [&_.input]:text-white [&_.input]:outline-none [&_.input]:focus:border-amber-100/45">{children}</span></label>;
}

function QuickAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex items-center justify-center gap-2 rounded-2xl border border-amber-100/35 bg-black/40 px-4 py-3 text-sm font-black text-amber-50 shadow-[0_0_20px_rgba(251,191,36,.07)] transition active:scale-95"><BadgePlus size={17} />{label}</button>;
}

function SmallAction({ label, icon, onClick, disabled = false }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-100/22 bg-black/35 px-2 py-2.5 text-[11px] font-black text-emerald-50/80 disabled:opacity-40">{icon}{label}</button>;
}
