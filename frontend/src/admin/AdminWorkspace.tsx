import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { CalendarClock, LayoutDashboard, UsersRound } from 'lucide-react';

import AdminAttentionPanel from './AdminAttentionPanel';
import AdminAuthGate from './AdminAuthGate';
import AdminStaffPanel from './AdminStaffPanel';
import CompactAdminPanel from './CompactAdminPanel';
import AdminTablesByLocation from './AdminTablesByLocation';
import AdminVisualTablePlanner from './AdminVisualTablePlanner';
import './admin-table-planner-fix.css';

type AdminSection = 'panel' | 'staff';

const LOCATION_PHOTOS: Record<string, string> = {
  'Зал ресторану': '/maps/hall-bg-numbered.png',
  'Навіс': '/maps/canopy-day-numbered.png',
  'Велика альтанка': '/maps/gazebo-day-numbered.png',
  'Ротанг': '/maps/rotang-day-numbered.png',
  'Набережна': '/maps/embankment-day-numbered.png',
  'Скляна альтанка': '/maps/glass-gazebo-day-numbered.png',
  'Альтанка на воді': '/maps/water-gazebo-day-numbered.png',
};

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('panel');
  const [planningOpen, setPlanningOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);

  useEffect(() => {
    Object.values(LOCATION_PHOTOS).forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, []);

  useEffect(() => {
    if (!planningOpen) return;

    const root = document.querySelector<HTMLElement>('[data-admin-location-planner]');
    if (!root) return;

    let frame = 0;

    const syncPhoto = () => {
      const image = root.querySelector<HTMLImageElement>('img[alt]');
      if (!image) return;

      const expectedDayPhoto = LOCATION_PHOTOS[image.alt];
      if (!expectedDayPhoto) return;

      const revealCurrentPhoto = () => {
        const currentExpectedPhoto = LOCATION_PHOTOS[image.alt];
        const currentPath = new URL(
          image.getAttribute('src') || '',
          window.location.origin,
        ).pathname;

        if (currentExpectedPhoto === expectedDayPhoto && currentPath === expectedDayPhoto) {
          image.dataset.moloPhotoLoading = 'false';
        }
      };

      const currentPath = new URL(
        image.getAttribute('src') || '',
        window.location.origin,
      ).pathname;

      if (image.dataset.moloDaySrc !== expectedDayPhoto || currentPath !== expectedDayPhoto) {
        image.dataset.moloPhotoLoading = 'true';
        image.addEventListener('load', revealCurrentPhoto, { once: true });
        image.dataset.moloDaySrc = expectedDayPhoto;
        image.dataset.moloFallback = expectedDayPhoto;
        delete image.dataset.moloFailedSrc;

        if (currentPath !== expectedDayPhoto) {
          image.setAttribute('src', expectedDayPhoto);
        } else if (image.complete) {
          revealCurrentPhoto();
        }
      } else if (image.complete) {
        revealCurrentPhoto();
      }

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
        activeElement.blur();
      }
    };

    const scheduleSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncPhoto);
    };

    scheduleSync();

    const observer = new MutationObserver(scheduleSync);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['alt'],
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [planningOpen]);

  function openGroupedTables(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button');
    if (!button || !button.closest('nav') || button.textContent?.trim() !== 'Столи') return;

    event.preventDefault();
    event.stopPropagation();
    setTablesOpen(true);
  }

  function closeGroupedTables() {
    setTablesOpen(false);
    window.requestAnimationFrame(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.molo-admin-workspace nav button'));
      buttons.find((button) => button.textContent?.trim() === 'Головна')?.click();
    });
  }

  return (
    <AdminAuthGate>
      <div
        className="molo-admin-workspace min-h-screen bg-black text-white"
        onClickCapture={openGroupedTables}
      >
        <style>
          {`
            .molo-admin-workspace > main > nav {
              bottom: 82px;
            }

            .molo-admin-workspace > main {
              padding-bottom: 176px;
            }
          `}
        </style>

        <div className="sticky top-0 z-[60] border-b border-white/10 bg-black/90 px-3 py-2 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <button
              type="button"
              onClick={() => setSection('panel')}
              className={`inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-black transition active:scale-[0.98] ${
                section === 'panel'
                  ? 'border-amber-200/60 bg-amber-300 text-neutral-950 shadow-[0_0_22px_rgba(251,191,36,.14)]'
                  : 'border-white/10 bg-white/[0.04] text-white/65'
              }`}
            >
              <LayoutDashboard size={18} />
              <span>Пульт</span>
            </button>

            <button
              type="button"
              onClick={() => setPlanningOpen(true)}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-3 text-sm font-black text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,.08)] transition active:scale-[0.98]"
            >
              <CalendarClock size={18} />
              <span className="truncate">План столів</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('staff')}
              className={`inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-black transition active:scale-[0.98] ${
                section === 'staff'
                  ? 'border-fuchsia-300/60 bg-fuchsia-300 text-neutral-950 shadow-[0_0_22px_rgba(217,70,239,.14)]'
                  : 'border-white/10 bg-white/[0.04] text-white/65'
              }`}
            >
              <UsersRound size={18} />
              <span>Персонал</span>
            </button>
          </div>
        </div>

        {section === 'panel' ? (
          <>
            <AdminAttentionPanel />
            <CompactAdminPanel />
          </>
        ) : (
          <main className="mx-auto min-h-screen max-w-5xl px-3 pb-36 pt-3 sm:px-4 lg:px-8">
            <section className="rounded-[28px] border border-fuchsia-300/20 bg-[radial-gradient(circle_at_top,rgba(217,70,239,.10),transparent_38%),rgba(10,10,10,.96)] p-3 shadow-[0_0_38px_rgba(217,70,239,.08)] sm:p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-fuchsia-300/30 bg-fuchsia-400/10 text-fuchsia-100">
                  <UsersRound size={20} />
                </span>
                <div>
                  <h1 className="text-xl font-black">Персонал</h1>
                  <p className="text-xs text-white/45">Зміни, доступ і працівники ресторану</p>
                </div>
              </div>
              <AdminStaffPanel />
            </section>
          </main>
        )}

        {tablesOpen && <AdminTablesByLocation onClose={closeGroupedTables} />}

        {planningOpen && (
          <div data-admin-location-planner>
            <AdminVisualTablePlanner onClose={() => setPlanningOpen(false)} />
          </div>
        )}
      </div>
    </AdminAuthGate>
  );
}
