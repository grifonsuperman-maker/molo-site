import { useEffect, useMemo, useState } from "react";
import { bookingsApi } from "../api/bookings";
import { clearAccessToken } from "../api/client";
import { staffApi, type StaffMember } from "../api/staff";
import { tablesApi } from "../api/tables";
import {
  waiterCallsApi,
  type WaiterCall,
} from "../api/waiterCalls";
import type { Booking, TableItem } from "../api/types";

const SESSION_KEY = "molo_waiter_staff";
const SHIFT_ENDED_KEY = "molo_waiter_shift_ended_name";
const ACTIVE = new Set(["pending", "approved"]);
const STATUS_LABELS: Record<string, string> = {
  pending: "Очікує",
  approved: "Підтверджено",
  rejected: "Відхилено",
  cancelled: "Скасовано",
  completed: "Завершено",
  free: "Вільний",
  reserved: "Підтверджено",
  occupied: "Зайнятий",
  cleaning: "Готується",
  closed: "Закритий",
};
const loc = (n: number) =>
  n <= 14
    ? "Зал ресторану"
    : n <= 20
      ? "Навіс"
      : n <= 36
        ? "Велика альтанка"
        : n <= 39
          ? "Ротанг"
          : n <= 44
            ? "Набережна"
            : n <= 50
              ? "Скляна альтанка"
              : n >= 100
                ? "Альтанка на воді"
                : "Інші столи";
const time = (v?: string | null) => String(v || "--:--").slice(0, 5);

function Login({ onLogin }: { onLogin: (staff: StaffMember) => void }) {
  const endedName = localStorage.getItem(SHIFT_ENDED_KEY);
  const [options, setOptions] = useState<
    { id: string; fullName: string; role: string; isOnShift: boolean }[]
  >([]);
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    staffApi
      .getLoginOptions()
      .then((v) => {
        const waiters = v.filter((x) => x.role === "waiter");
        setOptions(waiters);
        setStaffId(waiters[0]?.id || "");
      })
      .catch(() => setError("Не вдалося завантажити працівників."));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return setError("PIN має містити 4–6 цифр.");
    try {
      setBusy(true);
      setError("");
      const result = await staffApi.loginWithPin(staffId, pin);
      if (result.staff.role !== "waiter")
        throw new Error("Для пульта доступний лише офіціант.");
      localStorage.removeItem(SHIFT_ENDED_KEY);
      localStorage.setItem(SESSION_KEY, JSON.stringify(result.staff));
      onLogin(result.staff);
    } catch (x: any) {
      setError(x.message || "Не вдалося увійти.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-[#121313] px-4 py-8 text-white">
      {endedName && (
        <section className="mx-auto mb-4 max-w-md rounded-[30px] border border-amber-200/40 bg-black/35 p-6 text-center">
          <p className="text-xl font-black">
            Дякуємо за сьогоднішню зміну, {endedName} 🤍
          </p>
          <p className="mt-3 text-white/70">
            Гарного вечора та приємного відпочинку.
          </p>
          <p className="mt-2 text-sm text-white/55">
            Наступний вхід буде доступний після відкриття нової зміни
            Адміністратором.
          </p>
        </section>
      )}
      <form
        onSubmit={submit}
        className="mx-auto max-w-md rounded-[30px] border border-white/15 bg-black/35 p-6 shadow-[0_0_35px_rgba(251,191,36,.08)]"
      >
        <p className="text-xs tracking-[.25em] text-amber-200">MOLO</p>
        <h1 className="mt-2 text-3xl font-black">Пульт офіціанта</h1>
        <label className="mt-7 block text-sm text-white/70">
          Офіціант
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/15 bg-black/40 p-4 text-white"
          >
            {options.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.isOnShift}>
                {x.fullName}
                {x.isOnShift ? "" : " — не на зміні"}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-sm text-white/70">
          PIN
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="mt-2 w-full rounded-2xl border border-white/15 bg-black/40 p-4 text-xl tracking-[.4em] text-white"
          />
        </label>
        {error && <p className="mt-3 text-sm text-red-200">{error}</p>}
        <button
          disabled={busy || !staffId}
          className="mt-6 w-full rounded-2xl border border-amber-200/70 bg-amber-300/10 p-4 font-black text-amber-100 transition duration-150 active:scale-95"
        >
          {busy ? "Входимо…" : "Увійти"}
        </button>
      </form>
    </main>
  );
}

export default function WaiterApp() {
  const [staff, setStaff] = useState<StaffMember | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [tab, setTab] = useState<"calls" | "mine" | "all" | "history">("calls");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [transfer, setTransfer] = useState<Booking | null>(null);
  const [tables, setTables] = useState<TableItem[]>([]);
  const logout = () => {
    localStorage.setItem(SHIFT_ENDED_KEY, staff?.fullName || "");
    localStorage.removeItem(SESSION_KEY);
    clearAccessToken();
    setStaff(null);
  };
  async function load() {
    if (!staff) return;
    try {
      const [b, c] = await Promise.all([
        bookingsApi.getToday(),
        waiterCallsApi.list(),
      ]);
      setBookings(b);
      setCalls(c);
      setError("");
    } catch (x: any) {
      if (/зміну|заблокований|архівований|авторизац/i.test(x.message || ""))
        logout();
      else setError(x.message || "Не вдалося оновити дані.");
    }
  }
  useEffect(() => {
    load();
    const id = window.setInterval(load, 15000);
    return () => clearInterval(id);
  }, [staff?.id]);
  const active = useMemo(
    () => bookings.filter((b) => ACTIVE.has(b.status)),
    [bookings],
  );
  const mine = useMemo(
    () => active.filter((booking) => booking.assignedWaiterId === staff?.id),
    [active, staff?.id],
  );
  const transferGroups = useMemo(() => {
    const groups = new Map<string, TableItem[]>();
    for (const table of tables) {
      const location = table.zone?.name?.trim() || 'Без локації';
      const items = groups.get(location) || [];
      items.push(table);
      groups.set(location, items);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'uk'))
      .map(([location, items]) => ({
        location,
        tables: [...items].sort((left, right) => {
          const leftNumber = Number(left.tableNumber);
          const rightNumber = Number(right.tableNumber);
          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
          }
          return String(left.tableNumber).localeCompare(String(right.tableNumber), 'uk');
        }),
      }));
  }, [tables]);
  async function act(key: string, job: () => Promise<unknown>) {
    try {
      setBusy(key);
      await job();
      await load();
    } catch (x: any) {
      setError(x.message || "Дія не виконана.");
    } finally {
      setBusy("");
    }
  }
  async function openTransfer(b: Booking) {
    setTransfer(b);
    try {
      setTables(
        (await tablesApi.getAll()).filter(
          (t) => t.status === "free" && t.isVisible,
        ),
      );
    } catch (x: any) {
      setError(x.message || "Не вдалося завантажити столи.");
    }
  }
  if (!staff) return <Login onLogin={setStaff} />;
  const cards =
    tab === "mine"
      ? mine
      : tab === "history"
        ? bookings.filter((b) => !ACTIVE.has(b.status))
        : active;
  return (
    <main className="min-h-screen bg-[#121313] px-4 py-5 pb-28 text-white">
      <div className="mx-auto max-w-4xl">
        <header className="rounded-[30px] border border-white/15 bg-black/35 p-5 shadow-[0_0_36px_rgba(255,255,255,.04)]">
          <div className="flex justify-between gap-3">
            <div>
              <p className="text-xs tracking-[.25em] text-amber-200">MOLO</p>
              <h1 className="mt-1 text-3xl font-black">Пульт офіціанта</h1>
              <p className="mt-2 text-white/65">Офіціант: {staff.fullName}</p>
            </div>
            <button
              onClick={load}
              className="h-fit rounded-2xl border border-amber-200/50 bg-amber-300/10 px-4 py-3 text-amber-100 transition duration-150 active:scale-95"
            >
              Оновити
            </button>
          </div>
          <nav className="mt-5 grid grid-cols-2 gap-2">
            {(
              [
                ["calls", "Виклики"],
                ["mine", "Мої столи"],
                ["all", "Усі бронювання"],
                ["history", "Історія"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-2xl border px-3 py-3 font-bold transition duration-150 active:scale-95 ${tab === k ? "border-amber-200/70 bg-amber-300/10 text-white" : "border-white/10 bg-white/[.03] text-white/65"}`}
              >
                {l}
                {k === "calls" && calls.length ? (
                  <span className="ml-2 rounded-full border border-amber-200/70 px-2 py-1 text-xs text-amber-100 shadow-[0_0_12px_rgba(251,191,36,.7)]">
                    {calls.length}
                  </span>
                ) : (
                  ""
                )}
              </button>
            ))}
          </nav>
        </header>
        {error && (
          <p className="mt-4 rounded-2xl border border-red-300/40 p-3 text-red-100">
            {error}
          </p>
        )}
        {tab === "calls" ? (
          <section className="mt-4 grid gap-3">
            {calls.length ? (
              calls.map((c) => (
                <article
                  key={c.id}
                  className={`rounded-[28px] border bg-black/35 p-4 ${c.status === "new" ? "animate-pulse border-orange-300/70 shadow-[0_0_22px_rgba(251,100,40,.4)]" : "border-emerald-300/50"}`}
                >
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm text-white/65">Виклик офіціанта</p>
                      <h2 className="text-2xl font-black">
                        Стіл №{c.tableNumber || "—"}
                      </h2>
                      <p className="text-white/65">
                        {c.clientName || "Гість"} ·{" "}
                        {new Date(c.createdAt).toLocaleTimeString("uk-UA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <b className="h-fit rounded-full border border-amber-200/60 px-3 py-1 text-amber-100">
                      {c.status === "new" ? "Новий" : "Прийнято"}
                    </b>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      disabled={!!busy || c.status === "accepted"}
                      onClick={() =>
                        act(`a${c.id}`, () => waiterCallsApi.accept(c.id))
                      }
                      className="rounded-2xl border border-amber-200/70 bg-amber-300/10 p-3 text-amber-100 active:scale-95"
                    >
                      Прийняв
                    </button>
                    <button
                      disabled={!!busy || c.status !== "accepted"}
                      onClick={() =>
                        act(`c${c.id}`, () => waiterCallsApi.close(c.id))
                      }
                      className="rounded-2xl border border-emerald-200/70 bg-emerald-300/10 p-3 text-emerald-100 active:scale-95"
                    >
                      Закрити виклик
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="mt-4 text-white/60">Нових викликів немає.</p>
            )}
          </section>
        ) : (
          <section className="mt-4 grid gap-3">
            {cards.length ? cards.map((b) => {
              const tableStatus = b.table?.status;
              const checkedIn = Boolean(b.checkedInAt);
              const action: [string, () => Promise<unknown>, string] | null =
                b.status !== "approved" || !b.table
                  ? null
                  : checkedIn && tableStatus === "occupied"
                    ? [
                        "Гості пішли, почати прибирання",
                        () => tablesApi.cleaning(b.table!.id),
                        "cyan",
                      ]
                    : checkedIn && tableStatus === "cleaning"
                      ? [
                          "Стіл готовий",
                          () => bookingsApi.complete(b.id),
                          "green",
                        ]
                      : !checkedIn &&
                          tableStatus !== "occupied" &&
                          tableStatus !== "cleaning" &&
                          tableStatus !== "closed"
                        ? [
                            "Гість прийшов",
                            () =>
                              bookingsApi.checkIn(b.id).then(async () => {
                                try {
                                  await waiterCallsApi.assign({
                                    bookingId: b.id,
                                    tableId: b.table?.id,
                                    tableNumber: b.table?.tableNumber,
                                  });
                                } catch {
                                  // The database-backed check-in still keeps the table in "Мої столи".
                                }
                              }),
                            "gold",
                          ]
                        : null;
              const displayStatus =
                b.status === "approved" &&
                checkedIn &&
                (tableStatus === "occupied" || tableStatus === "cleaning")
                  ? tableStatus
                  : b.status;
              const showControls = Boolean(action) || b.status === "approved";
              return (
                <article
                  key={b.id}
                  className="rounded-[28px] border border-white/15 bg-black/35 p-4"
                >
                  <div className="flex justify-between">
                    <div>
                      <h2 className="text-2xl font-black">
                        Стіл №{b.table?.tableNumber || "—"}
                      </h2>
                      <p className="mt-1 text-lg">
                        {time(b.bookingTime)} · {b.client?.fullName || "Гість"}
                      </p>
                      <p className="text-sm text-white/60">
                        {loc(Number(b.table?.tableNumber || 0))} ·{" "}
                        {b.guestsCount} гостей
                      </p>
                    </div>
                    <span className="h-fit rounded-full border border-white/20 px-3 py-1 text-sm text-white/70">
                      {STATUS_LABELS[displayStatus] || displayStatus}
                    </span>
                  </div>
                  {b.wishes && (
                    <p className="mt-3 text-sm text-white/65">{b.wishes}</p>
                  )}
                  {showControls && (
                    <div className="mt-4 grid gap-2">
                      {action && (
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            if (confirm(action[0] + "?")) act(b.id, action[1]);
                          }}
                          className={`rounded-2xl border bg-white/[.03] p-3 font-bold active:scale-95 ${action[2] === "gold" ? "border-amber-200/75 text-amber-100" : action[2] === "cyan" ? "border-cyan-200/70 text-cyan-100" : "border-emerald-200/70 text-emerald-100"}`}
                        >
                          {action[0]}
                        </button>
                      )}
                      {b.status === "approved" && (
                        <button
                          disabled={!!busy}
                          onClick={() => openTransfer(b)}
                          className="rounded-2xl border border-amber-100/70 bg-white/[.03] p-3 font-bold text-amber-50 active:scale-95"
                        >
                          Змінити стіл
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            }) : <p className="text-white/60">Бронювань немає.</p>}
          </section>
        )}
        {transfer && (
          <div className="fixed inset-0 z-20 flex items-end bg-black/70">
            <div className="max-h-[80vh] w-full overflow-auto rounded-t-[30px] border border-white/15 bg-[#171818] p-5">
              <div className="flex justify-between">
                <h2 className="text-2xl font-black">Змінити стіл</h2>
                <button onClick={() => setTransfer(null)}>Закрити</button>
              </div>
              <p className="mt-2 text-white/60">
                Оберіть вільний стіл для бронювання.
              </p>
              <div className="mt-4 space-y-5">
                {transferGroups.map((group) => (
                  <section key={group.location}>
                    <h3 className="mb-2 text-sm font-black uppercase tracking-[.16em] text-amber-100/75">
                      {group.location}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {group.tables.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            if (
                              confirm(
                                `Пересадити гостей зі столу №${transfer.table?.tableNumber} на стіл №${t.tableNumber}?`,
                              )
                            )
                              act(`t${transfer.id}`, () =>
                                bookingsApi
                                  .waiterTransfer(transfer.id, t.id)
                                  .then(() => setTransfer(null)),
                              );
                          }}
                          className="rounded-2xl border border-white/20 bg-black/30 p-4 text-left active:scale-95"
                        >
                          <b>Стіл №{t.tableNumber}</b>
                          <span className="block text-sm text-white/55">
                            до {t.seats} місць
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
