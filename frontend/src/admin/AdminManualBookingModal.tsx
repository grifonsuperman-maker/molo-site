import type { ChangeEvent, ReactNode } from 'react';

import type { TableItem } from '../api/types';
import { locationLabel, NeonButton, TABLE_STATUS_LABEL } from './adminNeonShared';

export type ManualBookingForm = {
  fullName: string;
  phone: string;
  bookingDate: string;
  bookingTime: string;
  guestsCount: number;
  durationMinutes: number;
  tableId: string;
  wishes: string;
};

export default function AdminManualBookingModal({
  form,
  today,
  tables,
  busy,
  onChange,
  onSubmit,
  onClose,
}: {
  form: ManualBookingForm;
  today: string;
  tables: TableItem[];
  busy: boolean;
  onChange: (next: ManualBookingForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/80 p-3 backdrop-blur-md sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-amber-200/30 bg-neutral-950 p-4 shadow-[0_0_60px_rgba(251,191,36,.12)]">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-amber-100/55">Дзвінок гостя</p><h2 className="mt-1 text-2xl font-black">Бронювання телефоном</h2></div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white/70">Закрити</button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Ім’я гостя"><input value={form.fullName} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ ...form, fullName: event.target.value })} className="molo-admin-input" placeholder="Ім’я" /></Field>
          <Field label="Телефон"><input value={form.phone} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ ...form, phone: event.target.value })} className="molo-admin-input" placeholder="+380..." inputMode="tel" /></Field>
          <Field label="Дата"><input type="date" min={today} value={form.bookingDate} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ ...form, bookingDate: event.target.value })} className="molo-admin-input" /></Field>
          <Field label="Час"><input type="time" step="300" value={form.bookingTime} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ ...form, bookingTime: event.target.value })} className="molo-admin-input" /></Field>
          <Field label="Гостей"><input type="number" min={1} max={30} value={form.guestsCount} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ ...form, guestsCount: Number(event.target.value) })} className="molo-admin-input" /></Field>
          <Field label="Тривалість"><select value={form.durationMinutes} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange({ ...form, durationMinutes: Number(event.target.value) })} className="molo-admin-input"><option value={60}>1 година</option><option value={120}>2 години</option><option value={180}>3 години</option><option value={240}>4 години</option><option value={300}>5 годин</option><option value={360}>6 годин</option></select></Field>
          <div className="sm:col-span-2"><Field label="Стіл"><select value={form.tableId} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange({ ...form, tableId: event.target.value })} className="molo-admin-input"><option value="">Оберіть стіл</option>{tables.map((table) => {
            const unavailable = form.bookingDate === today && (table.status === 'occupied' || table.status === 'cleaning');
            const closed = table.status === 'closed' || table.zone?.isClosed;
            return <option key={table.id} value={table.id} disabled={closed || unavailable || table.seats < form.guestsCount}>№{table.tableNumber} · {locationLabel(table.tableNumber)} · до {table.seats} гостей · {TABLE_STATUS_LABEL[table.status]}</option>;
          })}</select></Field></div>
          <div className="sm:col-span-2"><Field label="Побажання"><textarea value={form.wishes} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...form, wishes: event.target.value })} className="molo-admin-input min-h-20" placeholder="Дитячий стілець, день народження..." /></Field></div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <NeonButton tone="amber" busy={busy} disabled={!form.fullName.trim() || !form.phone.trim() || !form.tableId || busy} onClick={onSubmit}>Створити бронь</NeonButton>
          <NeonButton tone="neutral" onClick={onClose}>Скасувати</NeonButton>
        </div>
      </div>
      <style>{`.molo-admin-input{width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.34);padding:12px 14px;color:white;outline:none}.molo-admin-input:focus{border-color:rgba(253,230,138,.48);box-shadow:0 0 22px rgba(251,191,36,.08)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{label}</span>{children}</label>;
}
