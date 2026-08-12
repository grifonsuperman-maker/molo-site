import { useEffect, useRef, useState } from "react";
import { clearAccessToken } from "./api/client";
import type { StaffAuthUser } from "./api/staff";
import GuestApp from "./guest/GuestApp";
import GuestBookingDecisionController from "./guest/GuestBookingDecisionController";
import GuestReviewDismissController from "./guest/GuestReviewDismissController";
import WaiterApp from "./waiter/WaiterAppV2";
import WaiterCallAlertController from "./waiter/WaiterCallAlertController";
import "./waiter/waiter-legacy-theme.css";
import "./waiter/waiter-call-alert.css";
import HookahApp from "./hookah/HookahApp";
import AdminWorkspace from "./admin/AdminWorkspace";
import "./admin/admin-neon-theme.css";
import DirectorWorkspace from "./director/DirectorWorkspace";
import SitePhotoController from "./theme/SitePhotoController";
import MoloSplash from "./theme/MoloSplash";
import { useTelegramAuth } from "./auth/useTelegramAuth";
import TelegramStaffLinkGate, {
  readTelegramStaffInviteToken,
} from "./telegram/TelegramStaffLinkGate";
import { resolveTelegramMode } from "./telegram/telegramRuntime";

type Mode = "guest" | "waiter" | "hookah" | "admin" | "director";

const HOOKAH_STAFF_STORAGE_KEY = "molo_hookah_staff";

function clearRoleSession(preserveTelegramToken = false) {
  if (!preserveTelegramToken) clearAccessToken();
  window.localStorage.removeItem(HOOKAH_STAFF_STORAGE_KEY);
}

function getModeFromHash(): Mode {
  const value = window.location.hash.replace("#", "");

  if (
    value === "waiter" ||
    value === "hookah" ||
    value === "admin" ||
    value === "director" ||
    value === "guest"
  ) {
    return value;
  }

  return "guest";
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => getModeFromHash());
  const [telegramInviteToken, setTelegramInviteToken] = useState<string | null>(
    () => readTelegramStaffInviteToken(),
  );
  const telegramAuth = useTelegramAuth();
  const telegramRoleRouted = useRef(false);

  useEffect(() => {
    if (
      telegramInviteToken ||
      telegramRoleRouted.current ||
      !telegramAuth.isTelegram ||
      !telegramAuth.user
    ) {
      return;
    }

    telegramRoleRouted.current = true;

    const nextMode = resolveTelegramMode(
      telegramAuth.user.role,
      window.location.hash,
    );

    if (nextMode && nextMode !== mode) {
      window.location.hash = nextMode;
      setMode(nextMode);
    }
  }, [mode, telegramAuth.isTelegram, telegramAuth.user, telegramInviteToken]);

  useEffect(() => {
    function handleHashChange() {
      const nextMode = getModeFromHash();

      setMode((currentMode) => {
        if (nextMode !== currentMode) {
          clearRoleSession(telegramAuth.isTelegram);
        }

        return nextMode;
      });
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [telegramAuth.isTelegram]);

  function changeMode(nextMode: Mode) {
    if (nextMode !== mode) {
      clearRoleSession(telegramAuth.isTelegram);
    }

    window.location.hash = nextMode;
    setMode(nextMode);
  }

  function handleTelegramLinked(user: StaffAuthUser) {
    const nextMode = resolveTelegramMode(user.role, "#guest") || "guest";
    const url = new URL(window.location.href);
    url.searchParams.delete("tgWebAppStartParam");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );

    telegramRoleRouted.current = true;
    setTelegramInviteToken(null);
    window.location.hash = nextMode;
    setMode(nextMode);
  }

  return (
    <main className="min-h-screen bg-[#10100f] text-white">
      <MoloSplash />
      <SitePhotoController />

      {telegramInviteToken && (
        <TelegramStaffLinkGate
          token={telegramInviteToken}
          onLinked={handleTelegramLinked}
        />
      )}

      {telegramAuth.isTelegram && telegramAuth.error && !telegramInviteToken && (
        <div className="fixed left-3 right-3 top-3 z-[70] rounded-2xl border border-red-400/40 bg-red-950/95 px-4 py-3 text-center text-sm text-red-100 shadow-2xl">
          Не вдалося увійти через Telegram. Закрийте та відкрийте застосунок повторно.
        </div>
      )}

      <div className="fixed bottom-4 left-1/2 z-50 grid w-[calc(100%-24px)] max-w-xl -translate-x-1/2 grid-cols-5 gap-1.5 rounded-2xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-2xl">
        <button
          onClick={() => changeMode("guest")}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === "guest"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Гість
        </button>

        <button
          onClick={() => changeMode("waiter")}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === "waiter"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Офіціант
        </button>

        <button
          onClick={() => changeMode("hookah")}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === "hookah"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Кальянник
        </button>

        <button
          onClick={() => changeMode("admin")}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === "admin"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Адмін
        </button>

        <button
          onClick={() => changeMode("director")}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === "director"
              ? "bg-amber-300 text-neutral-950"
              : "bg-neutral-800 text-white"
          }`}
        >
          Директор
        </button>
      </div>

      {mode === "guest" && (
        <>
          <GuestApp />
          <GuestBookingDecisionController />
          <GuestReviewDismissController />
        </>
      )}
      {mode === "waiter" && (
        <div className="molo-waiter-legacy-theme">
          <WaiterCallAlertController />
          <WaiterApp />
        </div>
      )}
      {mode === "hookah" && <HookahApp />}
      {mode === "admin" && (
        <div className="molo-admin-neon-theme">
          <AdminWorkspace />
        </div>
      )}
      {mode === "director" && <DirectorWorkspace />}
    </main>
  );
}
