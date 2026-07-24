import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { CalendarClock, LayoutDashboard, UsersRound } from 'lucide-react';

import AdminAttentionCenter from './AdminAttentionCenter';
import AdminAuthGate from './AdminAuthGate';
import AdminStaffPanel from './AdminStaffPanel';
import CompactAdminPanel from './CompactAdminPanel';
import AdminTablesByLocation from './AdminTablesByLocation';
import AdminVisualTablePlanner from './AdminVisualTablePlanner';
import './admin-table-planner-fix.css';

type AdminSection = 'panel' | 'staff';
type CompactTab = 'home' | 'bookings' | 'tables' | 'guests' | 'more';

const LOCATION_PHOTOS: Record<string, string> = {
  'Зал ресторану': '/maps/hall-bg-numbered.png',
  'Навіс': '/maps/canopy-day-numbered.png',
  'Велика альтанка': '/maps/gazebo-day-numbered.png',
  'Ротанг': '/maps/rotang-day-numbered.png',
  'Набережна': '/maps/embankment-day-numbered.png',
  'Скляна альтанка': '/maps/glass-gazebo-day-numbered.png',
  'Альтанка на воді': '/maps/water-gazebo-day-numbered.png',
};

const COMPACT_TAB_BY_LABEL: Record<string, CompactTab> = {
  'Головна': 'home',
  'Броні': 'bookings',
  'Столи': 'tables',
  'Гості': 'guests',
  'Ще': 'more',
};

export default function AdminWorkspace() {
  const [section, setSection] = useState<AdminSection>('panel');
  const [compactTab, setCompactTab] = useState<CompactTab>('home');
  const [planningOpen, setPlanningOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);

  useEffect(() => {
    Object.values(LOCATION_PHOTOS).forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, []);

  useEffect(() => {
    if (section !== 'panel') return;

    const workspace = document.querySelector<HTMLElement>('.molo-admin-workspace');
    if (!workspace) return;

    const syncActiveTab = () => {
      const nav = workspace.querySelector<HTMLElement>(':scope > main > nav');
      if (!nav) return;

      const activeButton = Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.className.includes('bg-amber-300'),
      );
      const nextTab = COMPACT_TAB_BY_LABEL[activeButton?.textContent?.trim() || ''];
      if (nextTab && nextTab !== 'tables') setCompactTab(nextTab);
    };

    syncActiveTab();
    const observer = new MutationObserver(syncActiveTab);
    observer.observe(workspace, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [section]);

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

  function openAdminTab(label: 'Головна' | 'Броні' | 'Гості') {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.molo-admin-workspace > main > nav button'),
    );
    buttons.find((button) => button.textContent?.trim() === label)?.click();
  }

  function handleWorkspaceClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button');
    if (!button || !button.closest('nav')) return;

    const label = button.textContent?.trim() || '';
    const nextTab = COMPACT_TAB_BY_LABEL[label];
    if (!nextTab) return;

    if (nextTab === 'tables') {
      event.preventDefault();
      event.stopPropagation();
      setCompactTab('tables');
      setTablesOpen(true);
      return;
    }

    setCompactTab(nextTab);
  }

  function closeGroupedTables() {
    setTablesOpen(false);
    setCompactTab('home');
    window.requestAnimationFrame(() => openAdminTab('Головна'));
  }

  return (
    <AdminAuthGate>
      <div
        className="molo-admin-workspace min-h-screen bg-black text-white"
        data-compact-tab={compactTab}
        onClickCapture={handleWorkspaceClick}
      >
        <style>
          {`
            .molo-admin-workspace > main > nav {
              bottom: 82px;
            }

            .molo-admin-workspace > main {
              padding-bottom: 176px;
            }

            .molo-admin-workspace[data-compact-tab="home"] > main > section:first-of-type > :first-child {
              display: none;
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
            {compactTab === 'home' && (
              <AdminAttentionCenter
                onOpenBookings={() => openAdminTab('Броні')}
                onOpenGuests={() => openAdminTab('Гості')}
              />
            )}
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
