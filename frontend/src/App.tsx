import { useEffect, useState } from 'react';
import { clearAccessToken } from './api/client';
import GuestApp from './guest/GuestApp';
import GuestWaiterCallController from './guest/GuestWaiterCallController';
import GuestReviewDismissController from './guest/GuestReviewDismissController';
import GuestBookingNotificationController from './guest/GuestBookingNotificationController';
import WaiterApp from './waiter/WaiterAppV2';
import WaiterCallAlertController from './waiter/WaiterCallAlertController';
import './waiter/waiter-legacy-theme.css';
import './waiter/waiter-call-alert.css';
import HookahApp from './hookah/HookahApp';
import AdminWorkspace from './admin/AdminWorkspace';
import './admin/admin-neon-theme.css';
import DirectorPanel from './director/DirectorPanel';
import SitePhotoController from './theme/SitePhotoController';
import SiteModeSwitch from './theme/SiteModeSwitch';

type Mode = 'guest' | 'waiter' | 'hookah' | 'admin' | 'director';

const HOOKAH_STAFF_STORAGE_KEY = 'molo_hookah_staff';

function getModeFromHash(): Mode {
  const value = window.location.hash.replace('#', '');

  if (
    value === 'waiter' ||
    value === 'hookah' ||
    value === 'admin' ||
    value === 'director' ||
    value === 'guest'
  ) {
    return value;
  }

  return 'guest';
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => getModeFromHash());

  useEffect(() => {
    function handleHashChange() {
      setMode(getModeFromHash());
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  function changeMode(nextMode: Mode) {
    if (nextMode !== mode) {
      clearAccessToken();
      window.localStorage.removeItem(HOOKAH_STAFF_STORAGE_KEY);
    }

    window.location.hash = nextMode;
    setMode(nextMode);
  }

  return (
    <main className="min-h-screen bg-[#10100f] text-white">
      <SitePhotoController />

      <div className="fixed bottom-4 left-1/2 z-50 grid w-[calc(100%-24px)] max-w-xl -translate-x-1/2 grid-cols-5 gap-1.5 rounded-2xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-2xl">
        <button
          onClick={() => changeMode('guest')}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === 'guest'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-neutral-800 text-white'
          }`}
        >
          Гість
        </button>

        <button
          onClick={() => changeMode('waiter')}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === 'waiter'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-neutral-800 text-white'
          }`}
        >
          Офіціант
        </button>

        <button
          onClick={() => changeMode('hookah')}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === 'hookah'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-neutral-800 text-white'
          }`}
        >
          Кальянник
        </button>

        <button
          onClick={() => changeMode('admin')}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === 'admin'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-neutral-800 text-white'
          }`}
        >
          Адмін
        </button>

        <button
          onClick={() => changeMode('director')}
          className={`rounded-xl px-1.5 py-2 text-[11px] font-semibold ${
            mode === 'director'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-neutral-800 text-white'
          }`}
        >
          Директор
        </button>
      </div>

      {mode === 'guest' && (
        <>
          <GuestApp />
          <GuestWaiterCallController />
          <GuestReviewDismissController />
          <GuestBookingNotificationController />
        </>
      )}
      {mode === 'waiter' && (
        <div className="molo-waiter-legacy-theme">
          <WaiterCallAlertController />
          <WaiterApp />
        </div>
      )}
      {mode === 'hookah' && <HookahApp />}
      {mode === 'admin' && (
        <>
          <SiteModeSwitch role="admin" />
          <div className="molo-admin-neon-theme">
            <AdminWorkspace />
          </div>
        </>
      )}
      {mode === 'director' && (
        <>
          <SiteModeSwitch role="director" />
          <DirectorPanel />
        </>
      )}
    </main>
  );
}
