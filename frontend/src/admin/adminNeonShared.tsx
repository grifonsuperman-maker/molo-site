import type { ReactNode } from 'react';

import type { Booking, TableStatus } from '../api/types';

export type BookingAction = 'approve' | 'reject' | 'cancel' | 'checkIn' | 'cleaning' | 'complete' | 'noShow';
export type TableAction = 'free' | 'occupied' | 'cleaning' | 'close' | 'open';
export type Tone = 'amber' | 'green' | 'red' | 'blue' | 'cyan' | 'violet' | 'neutral';

export const ACTIVE_STATUSES = new Set(['pending', 'approved']);
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Очікує підтвердження',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
};
export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  free: 'Вільний',
  pending: 'Очікує',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};
export const TABLE_STATUS_COLOR: Record<TableStatus, string> = {
  free: '#ffffff',
  pending: '#38bdf8',
  reserved: '#fb923c',
  occupied: '#ff3b4f',
  cleaning: '#67e8f9',
  closed: '#bdbdbd',
};

export function unwrap<T>(value: T | { data?: T }): T {
  if (value && typeof value === 'object' && 'data' in value && (value as { data?: T }).data) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function formatTime(value: string | null | undefined) {
  return String(value || '').slice(0, 5) || '-';
}

export function normalizePhone(value: string | null | undefined) {
  return String(value || '').replace(/[^\d+]/g, '');
}

export function tableNumber(booking: Booking) {
  return booking.table?.tableNumber || '-';
}

export function locationLabel(raw: string | number | null | undefined) {
  const value = Number(raw || 0);
  if (value >= 1 && value <= 14) return 'Зал ресторану';
  if (value >= 15 && value <= 20) return 'Навіс';
  if (value >= 21 && value <= 36) return 'Велика альтанка';
  if (value >= 37 && value <= 39) return 'Ротанг';
  if (value >= 40 && value <= 44) return 'Набережна';
  if (value >= 45 && value <= 50) return 'Скляна альтанка';
  if (value >= 100 && value <= 109) return 'Альтанка на воді';
  return 'Інші столи';
}

export function bookingStatusClass(status: string) {
  return ({
    pending: 'border-sky-300/45 bg-sky-400/10 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,.12)]',
    approved: 'border-orange-300/45 bg-orange-400/10 text-orange-100 shadow-[0_0_18px_rgba(251,146,60,.12)]',
    rejected: 'border-red-300/35 bg-red-500/10 text-red-100',
    cancelled: 'border-white/15 bg-white/5 text-white/55',
    completed: 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100',
  } as Record<string, string>)[status] || 'border-white/15 bg-white/5 text-white/70';
}

export function isNoShow(booking: Booking) {
  return String(booking.wishes || '').includes('[NO_SHOW]');
}

export function guestWishes(booking: Booking) {
  return String(booking.wishes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Час відпочинку:') && !line.startsWith('Підготовка столу') && !line.includes('[NO_SHOW]'));
}

export function NeonButton({ tone, children, onClick, disabled = false, busy = false, compact = false }: {
  tone: Tone; children: ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean; compact?: boolean;
}) {
  const classes: Record<Tone, string> = {
    amber: 'border-amber-200/45 bg-amber-300/10 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,.10)]',
    green: 'border-emerald-200/40 bg-emerald-400/10 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,.10)]',
    red: 'border-red-300/35 bg-red-500/10 text-red-100 shadow-[0_0_20px_rgba(239,68,68,.08)]',
    blue: 'border-sky-300/40 bg-sky-400/10 text-sky-100 shadow-[0_0_20px_rgba(56,189,248,.10)]',
    cyan: 'border-cyan-200/40 bg-cyan-300/10 text-cyan-100 shadow-[0_0_20px_rgba(103,232,249,.10)]',
    violet: 'border-violet-300/40 bg-violet-400/10 text-violet-100 shadow-[0_0_20px_rgba(167,139,250,.10)]',
    neutral: 'border-white/15 bg-white/[0.04] text-white/65',
  };
  return <button type="button" onClick={onClick} disabled={disabled || busy} className={`rounded-2xl border font-black transition active:scale-95 disabled:opacity-35 ${compact ? 'px-3 py-2.5 text-xs' : 'px-3 py-3 text-sm'} ${classes[tone]}`}>{busy ? 'Зачекайте...' : children}</button>;
}

export function CompactInfo({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5"><p className="text-[9px] uppercase tracking-[0.12em] text-white/30">{label}</p><div className="mt-1 truncate text-xs font-bold text-white/75">{value}</div></div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/40">{children}</div>;
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl border px-2 py-2.5 text-xs font-black transition active:scale-95 ${active ? 'border-amber-200/60 bg-amber-300/15 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,.14)]' : 'border-white/10 bg-white/[0.03] text-white/55'}`}>{children}</button>;
}

export function DateButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-xl border px-2 py-2 text-[11px] font-black transition active:scale-95 ${active ? 'border-violet-200/60 bg-violet-400/15 text-violet-100 shadow-[0_0_20px_rgba(167,139,250,.12)]' : 'border-white/10 bg-white/[0.03] text-white/55'}`}>{children}</button>;
}
