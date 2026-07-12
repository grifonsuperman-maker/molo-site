import { useState } from "react";
import GuestApp from "./guest/GuestApp";
import WaiterApp from "./waiter/WaiterApp";
import AdminPanel from "./admin/AdminPanel";
import DirectorPanel from "./director/DirectorPanel";

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
