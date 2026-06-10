import { useState } from "react";
import GuestApp from "./guest/GuestApp";
import WaiterApp from "./waiter/WaiterApp";
import AdminPanel from "./admin/AdminPanel";
import ConstructorApp from "./constructor/ConstructorApp";

type Mode = "guest" | "waiter" | "admin" | "constructor";

export default function App() {
  const [mode, setMode] = useState<Mode>("guest");

  return (
    <main className="min-h-screen bg-[#10100f] text-white">
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-2xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-2xl">
        <button
          onClick={() => setMode("guest")}
          className={`rounded-xl px-3 py-2 text-xs ${
            mode === "guest"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800"
          }`}
        >
          Гість
        </button>

        <button
          onClick={() => setMode("waiter")}
          className={`rounded-xl px-3 py-2 text-xs ${
            mode === "waiter"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800"
          }`}
        >
          Офіціант
        </button>

        <button
          onClick={() => setMode("admin")}
          className={`rounded-xl px-3 py-2 text-xs ${
            mode === "admin"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800"
          }`}
        >
          Адмін
        </button>

        <button
          onClick={() => setMode("constructor")}
          className={`rounded-xl px-3 py-2 text-xs ${
            mode === "constructor"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800"
          }`}
        >
          Конструктор
        </button>
      </div>

      {mode === "guest" && <GuestApp />}
      {mode === "waiter" && <WaiterApp />}
      {mode === "admin" && <AdminPanel />}
      {mode === "constructor" && <ConstructorApp />}
    </main>
  );
}
