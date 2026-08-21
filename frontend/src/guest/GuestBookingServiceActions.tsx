import { BellRing, Flame } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GuestBooking } from '../api/bookings';
import {
  hookahCallsApi,
  type GuestHookahStatus,
} from '../api/hookah-calls';
import {
  waiterCallsApi,
  type GuestWaiterCallStatus,
} from '../api/waiterCalls';
import {
  isGuestServiceBookingForToday,
  isGuestServiceStatusSnapshotCurrent,
  shouldRefreshGuestServiceStatusOnVisibility,
} from './waiterCallVisibility';

const POLLING_INTERVAL_MS = 15_000;
const BURST_DURATION_MS = 720;

type ServiceKind = 'waiter' | 'hookah';

function kyivDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
  }).format(new Date());
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

export default function GuestBookingServiceActions({
  booking,
}: {
  booking: GuestBooking;
}) {
  const bookingIsToday = useMemo(
    () => isGuestServiceBookingForToday(booking, kyivDate()),
    [booking],
  );
  const [waiterStatus, setWaiterStatus] =
    useState<GuestWaiterCallStatus | null>(null);
  const [hookahStatus, setHookahStatus] =
    useState<GuestHookahStatus | null>(null);
  const [waiterLoading, setWaiterLoading] = useState(bookingIsToday);
  const [hookahLoading, setHookahLoading] = useState(bookingIsToday);
  const [waiterCalling, setWaiterCalling] = useState(false);
  const [hookahCalling, setHookahCalling] = useState(false);
  const [waiterError, setWaiterError] = useState<string | null>(null);
  const [hookahError, setHookahError] = useState<string | null>(null);
  const [waiterMessage, setWaiterMessage] = useState<string | null>(null);
  const [hookahMessage, setHookahMessage] = useState<string | null>(null);
  const [burst, setBurst] = useState<ServiceKind | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const burstTimer = useRef<number | null>(null);
  const waiterStatusRequestId = useRef(0);
  const hookahStatusRequestId = useRef(0);
  const waiterMutationVersion = useRef(0);
  const hookahMutationVersion = useRef(0);

  const loadWaiterStatus = useCallback(async (silent = false) => {
    const requestId = ++waiterStatusRequestId.current;
    const mutationVersion = waiterMutationVersion.current;
    const snapshotIsCurrent = () => isGuestServiceStatusSnapshotCurrent(
      requestId,
      waiterStatusRequestId.current,
      mutationVersion,
      waiterMutationVersion.current,
    );

    if (!bookingIsToday) {
      setWaiterStatus(null);
      setWaiterLoading(false);
      return;
    }

    try {
      if (!silent) setWaiterLoading(true);
      const result = await waiterCallsApi.guestStatus(booking.bookingId);
      if (!snapshotIsCurrent()) return;
      setWaiterStatus(result);
      setWaiterError(null);
    } catch (loadError) {
      if (!snapshotIsCurrent()) return;
      setWaiterError(errorText(loadError));
    } finally {
      if (requestId === waiterStatusRequestId.current) {
        setWaiterLoading(false);
      }
    }
  }, [booking.bookingId, bookingIsToday]);

  const loadHookahStatus = useCallback(async (silent = false) => {
    const requestId = ++hookahStatusRequestId.current;
    const mutationVersion = hookahMutationVersion.current;
    const snapshotIsCurrent = () => isGuestServiceStatusSnapshotCurrent(
      requestId,
      hookahStatusRequestId.current,
      mutationVersion,
      hookahMutationVersion.current,
    );

    if (!bookingIsToday) {
      setHookahStatus(null);
      setHookahLoading(false);
      return;
    }

    try {
      if (!silent) setHookahLoading(true);
      const result = await hookahCallsApi.getGuestStatus(booking.bookingId);
      if (!snapshotIsCurrent()) return;
      setHookahStatus(result);
      setHookahError(null);
    } catch (loadError) {
      if (!snapshotIsCurrent()) return;
      setHookahError(errorText(loadError));
    } finally {
      if (requestId === hookahStatusRequestId.current) {
        setHookahLoading(false);
      }
    }
  }, [booking.bookingId, bookingIsToday]);

  useEffect(() => {
    void loadWaiterStatus();
    if (!bookingIsToday) return;

    const interval = window.setInterval(() => {
      void loadWaiterStatus(true);
    }, POLLING_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [bookingIsToday, loadWaiterStatus]);

  useEffect(() => {
    void loadHookahStatus();
    if (!bookingIsToday) return;

    const interval = window.setInterval(() => {
      void loadHookahStatus(true);
    }, POLLING_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [bookingIsToday, loadHookahStatus]);

  useEffect(() => {
    if (!bookingIsToday) return;

    const refreshServiceStatuses = () => {
      void loadWaiterStatus(true);
      void loadHookahStatus(true);
    };
    const handleVisibilityChange = () => {
      if (
        shouldRefreshGuestServiceStatusOnVisibility(document.visibilityState)
      ) {
        refreshServiceStatuses();
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshServiceStatuses();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [bookingIsToday, loadHookahStatus, loadWaiterStatus]);

  useEffect(() => {
    if (
      hookahStatus?.activeCall?.status !== 'accepted' ||
      !hookahStatus.activeCall.etaDueAt
    ) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [
    hookahStatus?.activeCall?.etaDueAt,
    hookahStatus?.activeCall?.status,
  ]);

  useEffect(() => () => {
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
  }, []);

  function showBurst(service: ServiceKind) {
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    setBurst(null);
    window.requestAnimationFrame(() => setBurst(service));
    burstTimer.current = window.setTimeout(() => {
      setBurst(null);
      burstTimer.current = null;
    }, BURST_DURATION_MS);
  }

  async function callWaiter() {
    if (!bookingIsToday || !waiterStatus?.canCall || waiterStatus.activeCall) {
      return;
    }
    showBurst('waiter');
    waiterMutationVersion.current += 1;

    try {
      setWaiterCalling(true);
      setWaiterError(null);
      setWaiterMessage(null);
      const result = await waiterCallsApi.createFromGuest(booking.bookingId);
      waiterMutationVersion.current += 1;
      setWaiterStatus((current) => ({
        bookingId: booking.bookingId,
        tableNumber:
          result.call.tableNumber || current?.tableNumber || booking.tableNumber,
        bookingStatus: current?.bookingStatus || booking.status,
        tableStatus: current?.tableStatus || 'occupied',
        canCall: true,
        waiterAssigned: Boolean(result.call.waiterId || current?.waiterAssigned),
        waiterName: result.call.waiterName || current?.waiterName || null,
        activeCall: result.call,
      }));
      setWaiterMessage(result.message || 'Виклик офіціанта відправлено');
    } catch (callError) {
      setWaiterError(errorText(callError));
    } finally {
      setWaiterCalling(false);
    }
  }

  async function callHookahWorker() {
    if (!bookingIsToday || !hookahStatus?.canCall || hookahStatus.activeCall) {
      return;
    }
    showBurst('hookah');
    hookahMutationVersion.current += 1;

    try {
      setHookahCalling(true);
      setHookahError(null);
      setHookahMessage(null);
      const result = await hookahCallsApi.createFromGuest(booking.bookingId);
      hookahMutationVersion.current += 1;
      setHookahStatus((current) => ({
        bookingId: booking.bookingId,
        bookingStatus: current?.bookingStatus || booking.status,
        tableStatus: current?.tableStatus || 'occupied',
        tableNumber: result.call.tableNumber || current?.tableNumber || null,
        zoneName: result.call.zoneName || current?.zoneName || null,
        canCall: false,
        hookahCallsAvailable: current?.hookahCallsAvailable !== false,
        activeCall: result.call,
      }));
      setHookahMessage(result.message);
    } catch (callError) {
      setHookahError(errorText(callError));
    } finally {
      setHookahCalling(false);
    }
  }

  const waiterCall = waiterStatus?.activeCall || null;
  const hookahCall = hookahStatus?.activeCall || null;
  const waiterEnabled = Boolean(
    bookingIsToday &&
    !waiterLoading &&
    waiterStatus?.canCall &&
    !waiterCall &&
    !waiterCalling,
  );
  const hookahEnabled = Boolean(
    bookingIsToday &&
    !hookahLoading &&
    hookahStatus?.canCall &&
    hookahStatus.hookahCallsAvailable &&
    !hookahCall &&
    !hookahCalling,
  );

  const waiterSubtitle = !bookingIsToday
    ? 'У день візиту'
    : waiterLoading
      ? 'Перевіряємо…'
      : waiterCall?.status === 'accepted'
        ? 'Виклик прийнято'
        : waiterCall
          ? 'Виклик надіслано'
          : waiterStatus?.canCall
            ? waiterCalling ? 'Викликаємо…' : 'Викликати'
            : 'Після приходу';

  const hookahSubtitle = !bookingIsToday
    ? 'У день візиту'
    : hookahLoading
      ? 'Перевіряємо…'
      : hookahCall?.status === 'accepted'
        ? 'Уже прямує'
        : hookahCall
          ? 'Виклик надіслано'
          : hookahStatus?.hookahCallsAvailable === false
            ? 'Немає вільних'
            : hookahStatus?.canCall
              ? hookahCalling ? 'Викликаємо…' : 'Викликати'
              : 'Після приходу';

  const secondsLeft = hookahCall?.etaDueAt
    ? Math.max(
        0,
        Math.ceil((new Date(hookahCall.etaDueAt).getTime() - now) / 1_000),
      )
    : 0;
  const countdown = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <section
      className="mt-4"
      aria-label="Виклик персоналу для цього бронювання"
    >
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void callWaiter()}
          disabled={!waiterEnabled}
          aria-label={`Офіціант: ${waiterSubtitle}`}
          title={
            bookingIsToday
              ? 'Викликати офіціанта після приходу за стіл'
              : 'Виклик офіціанта стане доступним у день візиту'
          }
          className={`molo-service-action molo-service-action--waiter relative aspect-square min-h-[112px] rounded-[24px] border border-cyan-200/55 bg-cyan-300/10 p-3 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,.16)] transition duration-200 enabled:active:scale-[0.97] disabled:cursor-not-allowed ${!waiterEnabled && !waiterCall ? 'opacity-55' : ''} ${burst === 'waiter' ? 'molo-service-action--burst' : ''}`}
        >
          <span className="relative z-[1] flex h-full flex-col items-center justify-center">
            <BellRing aria-hidden="true" className="h-7 w-7" />
            <span className="mt-2 text-sm font-black">Офіціант</span>
            <span className="mt-1 text-[11px] font-semibold text-cyan-100/65">
              {waiterSubtitle}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => void callHookahWorker()}
          disabled={!hookahEnabled}
          aria-label={`Кальянник: ${hookahSubtitle}`}
          title={
            bookingIsToday
              ? 'Викликати кальянника після приходу за стіл'
              : 'Виклик кальянника стане доступним у день візиту'
          }
          className={`molo-service-action molo-service-action--hookah relative aspect-square min-h-[112px] rounded-[24px] border border-fuchsia-200/55 bg-fuchsia-300/10 p-3 text-fuchsia-50 shadow-[0_0_24px_rgba(232,121,249,.16)] transition duration-200 enabled:active:scale-[0.97] disabled:cursor-not-allowed ${!hookahEnabled && !hookahCall ? 'opacity-55' : ''} ${burst === 'hookah' ? 'molo-service-action--burst' : ''}`}
        >
          <span className="relative z-[1] flex h-full flex-col items-center justify-center">
            <Flame aria-hidden="true" className="h-7 w-7" />
            <span className="mt-2 text-sm font-black">Кальянник</span>
            <span className="mt-1 text-[11px] font-semibold text-fuchsia-100/65">
              {hookahSubtitle}
            </span>
          </span>
        </button>
      </div>

      <div className="mt-2 space-y-1 text-left text-xs" aria-live="polite">
        {waiterCall && (
          <p className="text-cyan-100/75">
            {waiterCall.waiterName
              ? `Офіціант ${waiterCall.waiterName}`
              : 'Офіціант'}
            {waiterCall.status === 'accepted'
              ? ' прийняв виклик.'
              : ' отримав виклик.'}
          </p>
        )}
        {hookahCall && (
          <p className="text-fuchsia-100/75">
            {hookahCall.acceptedByStaffName || 'Кальянник'}
            {hookahCall.status === 'accepted'
              ? ` прямує до вас${hookahCall.etaDueAt ? ` · ${countdown}` : '.'}`
              : ' — виклик надіслано.'}
          </p>
        )}
        {!waiterCall && waiterMessage && (
          <p className="text-emerald-200/80">{waiterMessage}</p>
        )}
        {!hookahCall && hookahMessage && (
          <p className="text-emerald-200/80">{hookahMessage}</p>
        )}
        {waiterError && <p className="text-red-200">{waiterError}</p>}
        {hookahError && <p className="text-red-200">{hookahError}</p>}
      </div>
    </section>
  );
}
