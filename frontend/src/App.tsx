import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clearAccessToken } from "./api/client";
import type { StaffAuthUser } from "./api/staff";
import "./waiter/waiter-legacy-theme.css";
import "./waiter/waiter-call-alert.css";
import "./admin/admin-neon-theme.css";
import SitePhotoController from "./theme/SitePhotoController";
import MoloSplash from "./theme/components/MoloSplash";
import { useTelegramAuth } from "./auth/useTelegramAuth";
import TelegramStaffLinkGate, {
  readTelegramStaffInviteToken,
} from "./telegram/TelegramStaffLinkGate";
import { telegramRoleToMode } from "./telegram/telegramRuntime";
import { isDeveloperRoleSwitcherPath } from "./developer/developerRoleSwitcher";

const GuestApp = lazy(() => import("./guest/GuestApp"));
const GuestBookingDecisionController = lazy(
  () => import("./guest/components/GuestBookingDecisionController"),
);
const GuestReviewDismissController = lazy(
  () => import("./guest/GuestReviewDismissController"),
);
const WaiterApp = lazy(() => import("./waiter/WaiterAppV2"));
const WaiterCallAlertController = lazy(
  () => import("./waiter/WaiterCallAlertController"),
);
const HookahApp = lazy(() => import("./hookah/HookahApp"));
const AdminWorkspace = lazy(() => import("./admin/AdminWorkspace"));
const DirectorWorkspace = lazy(() => import("./director/DirectorWorkspace"));

type Mode = "guest" | "waiter" | "hookah" | "admin" | "director";

type RoleLoadBoundaryProps = {
  resetKey: Mode;
  children: ReactNode;
};

type RoleLoadBoundaryState = {
  failed: boolean;
};

class RoleLoadBoundary extends Component<
  RoleLoadBoundaryProps,
  RoleLoadBoundaryState
> {
  state: RoleLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): RoleLoadBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previousProps: RoleLoadBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mx-auto mt-8 max-w-md rounded-2xl border border-red-400/30 bg-red-950/70 p-5 text-center text-sm text-red-100">
          <p>Не вдалося завантажити цей розділ.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-xl bg-red-100 px-4 py-2 font-semibold text-red-950"
          >
            Оновити сторінку
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

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

function getInitialMode(): Mode {
  if (window.location.pathname === "/guest") {
    return "guest";
  }

  return getModeFromHash();
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => getInitialMode());
  const [telegramInviteToken, setTelegramInviteToken] = useState<string | null>(
    () => readTelegramStaffInviteToken(),
  );
  const telegramAuth = useTelegramAuth();
  const telegramRoleRouted = useRef(false);
  const showDeveloperRoleSwitcher =
    isDeveloperRoleSwitcherPath(window.location.pathname) &&
    !telegramAuth.isTelegram;

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

    const nextMode = telegramRoleToMode(telegramAuth.user.role);

    if (nextMode !== mode) {
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
    const nextMode = telegramRoleToMode(user.role);
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

      {showDeveloperRoleSwitcher && (
        <div className="fixed inset-x-0 top-0 z-[100] border-b border-white/10 bg-black/80 px-4 py-2 text-center text-xs text-white/80 backdrop-blur">
          <span className="mr-2">Тестовий режим ролей</span>
          <button
            type="button"
            onClick={() => changeMode("guest")}
            className="mr-2 rounded-lg border border-white/20 px-2 py-1"
          >
            Гість
          </button>
          <button
            type="button"
            onClick={() => changeMode("waiter")}
            className="mr-2 rounded-lg border border-white/20 px-2 py-1"
          >
            Офіціант
          </button>
          <button
            type="button"
            onClick={() => changeMode("hookah")}
            className="mr-2 rounded-lg border border-white/20 px-2 py-1"
          >
            Кальянник
          </button>
          <button
            type="button"
            onClick={() => changeMode("admin")}
            className="mr-2 rounded-lg border border-white/20 px-2 py-1"
          >
            Адмін
          </button>
          <button
            type="button"
            onClick={() => changeMode("director")}
            className="rounded-lg border border-white/20 px-2 py-1"
          >
            Директор
          </button>
        </div>
      )}

      <RoleLoadBoundary resetKey={mode}>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm text-white/70">
              Завантаження…
            </div>
          }
        >
          {mode === "guest" && <GuestApp />}
          {mode === "waiter" && (
            <>
              <WaiterCallAlertController />
              <WaiterApp />
            </>
          )}
          {mode === "hookah" && <HookahApp />}
          {mode === "admin" && (
            <>
              <GuestBookingDecisionController />
              <AdminWorkspace />
            </>
          )}
          {mode === "director" && <DirectorWorkspace />}
        </Suspense>
      </RoleLoadBoundary>

      {mode === "guest" && <GuestReviewDismissController />}
    </main>
  );
}
