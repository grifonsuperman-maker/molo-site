import { useState } from "react";
import GuestApp from "./guest/GuestApp";
import WaiterApp from "./waiter/WaiterApp";
import AdminPanel from "./admin/AdminPanel";

type Mode = "guest" | "waiter" | "admin" | "director";

export default function App() {
  const [mode, setMode] = useState<Mode>("guest");

  return (
    <main className="min-h-screen bg-[#10100f] text-white">
      <div className="fixed bottom-4 left-1/2 z-50 grid w-[calc(100%-32px)] max-w-md -translate-x-1/2 grid-cols-4 gap-2 rounded-2xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-2xl">
        <button
          onClick={() => setMode("guest")}
          className={`rounded-xl px-2 py-2 text-xs font-semibold ${
            mode === "guest"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Гість
        </button>

        <button
          onClick={() => setMode("waiter")}
          className={`rounded-xl px-2 py-2 text-xs font-semibold ${
            mode === "waiter"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Офіціант
        </button>

        <button
          onClick={() => setMode("admin")}
          className={`rounded-xl px-2 py-2 text-xs font-semibold ${
            mode === "admin"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Адмін
        </button>

        <button
          onClick={() => setMode("director")}
          className={`rounded-xl px-2 py-2 text-xs font-semibold ${
            mode === "director"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Директор
        </button>
      </div>

      {mode === "guest" && <GuestApp />}
      {mode === "waiter" && <WaiterApp />}
      {mode === "admin" && <AdminPanel />}
      {mode === "director" && <DirectorPanel />}
    </main>
  );
}

function DirectorPanel() {
  return (
    <div className="min-h-screen px-4 py-6 pb-28 lg:px-8">
      <header className="mb-6 rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
        <p className="text-sm uppercase tracking-[0.25em] text-amber-300/80">
          MOLO Restaurant
        </p>

        <h1 className="mt-2 text-2xl font-semibold">Пульт директора</h1>

        <p className="mt-2 text-sm text-neutral-400">
          Тут буде статистика ресторану, бронювання, гості, популярні столи та
          завантаження залу.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <DirectorStat label="Бронювань сьогодні" value="—" />
        <DirectorStat label="Гостей сьогодні" value="—" />
        <DirectorStat label="Зайнятих столів" value="—" />
      </section>

      <section className="mt-5 rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-xl font-semibold">Аналітика</h2>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <DirectorCard title="Популярні столи" text="Скоро підключимо з backend-аналітики." />
          <DirectorCard title="Популярні зони" text="Скоро підключимо з backend-аналітики." />
          <DirectorCard title="Постійні клієнти" text="Список гостей з історією відвідувань." />
          <DirectorCard title="Завантаження по годинах" text="Коли ресторан найбільше завантажений." />
        </div>
      </section>
    </div>
  );
}

function DirectorStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-amber-300">{value}</p>
    </div>
  );
}

function DirectorCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-neutral-400">{text}</p>
    </div>
  );
}
