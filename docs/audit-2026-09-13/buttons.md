# Инвентаризация элементов интерфейса

Это перечень объявлений в исходниках, а не сертификат успешного нажатия каждой кнопки. Динамические SVG-столы учитываются отдельно. Панели после входа требуют приёмки с тестовыми ролями.

| Файл | Строка | Элемент | Объявление |
|---|---:|---|---|
| `frontend/src/App.tsx` | 63 | button | <button type="button" onClick={() => |
| `frontend/src/App.tsx` | 193 | button | <button onClick={() => |
| `frontend/src/App.tsx` | 204 | button | <button onClick={() => |
| `frontend/src/App.tsx` | 215 | button | <button onClick={() => |
| `frontend/src/App.tsx` | 226 | button | <button onClick={() => |
| `frontend/src/App.tsx` | 237 | button | <button onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 172 | button | <button type="button" className="absolute inset-0" onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 176 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 186 | button | <button key={table.id} type="button" onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 197 | button | <button type="button" disabled={!selectedTableId &#124;&#124; Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 212 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 220 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 245 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminAttentionPanel.tsx` | 289 | button | <button type="button" disabled={disabled} onClick={onClick} className={rounded-2xl border bg-black/50 px-4 py-3 font-black disabled:opacity-40 ${classes[tone]}}> |
| `frontend/src/admin/AdminAuthGate.tsx` | 184 | button | <button type="button" onClick={handleLogout} className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white/80 transition hover:bg-white/10 active:scale-[0.98]" > |
| `frontend/src/admin/AdminAuthGate.tsx` | 271 | button | <button type="submit" disabled={ submitting &#124;&#124; loadingOptions &#124;&#124; !staffId &#124;&#124; adminOptions.length === 0 } className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-neutral-950 transition hover:bg-amber-200 active:scale-[0.98] disa |
| `frontend/src/admin/AdminAuthGate.tsx` | 284 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 824 | button | <button type="button" onClick={load} disabled={loading} className="rounded-full border border-amber-200/40 bg-amber-300/10 px-3 py-1 font-semibold text-amber-100 transition active:scale-95 disabled:opacity-50" > |
| `frontend/src/admin/AdminPanel.tsx` | 844 | button | <button key={item} type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 863 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 897 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 934 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1015 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1052 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1094 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1128 | a | <a className="mt-1 block text-sm text-amber-100" href={tel:${normalizePhone(client.phone)}}> |
| `frontend/src/admin/AdminPanel.tsx` | 1192 | button | <button key={mode} type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1220 | button | <button key={holiday.key} type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1278 | button | <button type="button" onClick={saveSettings} disabled={busyAction === 'settings:save'} className="mt-4 rounded-2xl bg-amber-300 px-5 py-4 font-bold text-neutral-950 transition active:scale-95 disabled:opacity-60" > |
| `frontend/src/admin/AdminPanel.tsx` | 1359 | a | <a className="text-amber-100 underline decoration-amber-200/30" href={tel:${normalizePhone(phone)}}> |
| `frontend/src/admin/AdminPanel.tsx` | 1378 | a | <a href={tel:${normalizePhone(phone)}} className="rounded-2xl border border-amber-200/35 bg-amber-300/10 px-4 py-3 text-center text-sm font-semibold text-amber-100 transition active:scale-95"> |
| `frontend/src/admin/AdminPanel.tsx` | 1456 | button | <button type="button" onClick={onClick} disabled={busy} className={rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-60 ${classes}}> |
| `frontend/src/admin/AdminPanel.tsx` | 1486 | button | <button type="button" onClick={onClick} disabled={disabled &#124;&#124; busy} className={rounded-2xl border px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-35 ${classes}}> |
| `frontend/src/admin/AdminPanel.tsx` | 1549 | button | <button type="button" onClick={onClick} className={rounded-[28px] border p-5 text-left transition active:scale-[0.99] ${toneClass}}> |
| `frontend/src/admin/AdminPanel.tsx` | 1571 | button | <button type="button" onClick={onClick} className="rounded-[30px] border border-white/10 bg-neutral-950 p-5 text-left shadow-xl transition active:scale-[0.99]"> |
| `frontend/src/admin/AdminPanel.tsx` | 1606 | button | <button type="button" onClick={onClick} className="w-full text-left transition active:scale-[0.99]"> |
| `frontend/src/admin/AdminPanel.tsx` | 1640 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminPanel.tsx` | 1648 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminReschedulePanel.tsx` | 105 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminReschedulePanel.tsx` | 125 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminReschedulePanel.tsx` | 173 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminReschedulePanel.tsx` | 185 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 263 | button | <button type="submit" disabled={creating} className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-neutral-950 transition active:scale-[0.98] disabled:opacity-40"> |
| `frontend/src/admin/AdminStaffPanel.tsx` | 270 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 307 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 316 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 318 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 327 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 332 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminStaffPanel.tsx` | 340 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 168 | button | <button key={table.id} type="button" onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 192 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 193 | button | <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/25 text-white/75"> |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 208 | button | <button key={location.key} type="button" onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 217 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 248 | button | <button type="button" onClick={onClose} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-transparent p-4 font-black text-white/70"> |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 256 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 260 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 261 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 262 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminTablesByLocation.tsx` | 263 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 428 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 428 | button | <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5"> |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 438 | button | <button key={item.key} type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 443 | button | <button type="button" disabled={!canManage} onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 457 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 459 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 459 | button | <button type="button" disabled={busy === 'manual-booking' &#124;&#124; !manualFullName.trim()} onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 461 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 461 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 461 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 461 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 461 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 463 | button | <button type="button" disabled={busy === remove:${block.id}} onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 465 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 465 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 465 | button | <button type="button" disabled={!transferTableId} onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 467 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 467 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminVisualTablePlanner.tsx` | 470 | button | <button type="button" disabled={!canManage &#124;&#124; !reason.trim() &#124;&#124; conflicts.length > |
| `frontend/src/admin/AdminWorkspace.tsx` | 153 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminWorkspace.tsx` | 166 | button | <button type="button" onClick={() => |
| `frontend/src/admin/AdminWorkspace.tsx` | 175 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 403 | button | <button type="button" onClick={toggleSound} className={inline-flex h-11 items-center gap-2 rounded-2xl border px-3 text-xs font-black transition active:scale-95 ${soundEnabled && audioUnlocked ? 'border-emerald-300/40 bg-emerald-400/10 tex |
| `frontend/src/admin/CompactAdminPanel.tsx` | 412 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 420 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 458 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 462 | button | <button key={booking.id} type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 511 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 531 | button | <button key={table.id} type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 547 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 553 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 554 | button | <button type="button" onClick={selectAllGuests} className={mt-3 w-full rounded-2xl border px-4 py-3 text-sm font-black transition ${sendToAll ? 'border-amber-200/60 bg-amber-300/20 text-amber-100' : 'border-white/10 bg-black/20 text-white/ |
| `frontend/src/admin/CompactAdminPanel.tsx` | 558 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 578 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 620 | button | <button type="button" onClick={onPrevious} className="p-1"> |
| `frontend/src/admin/CompactAdminPanel.tsx` | 620 | button | <button type="button" onClick={onNext} className="p-1"> |
| `frontend/src/admin/CompactAdminPanel.tsx` | 633 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 634 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 638 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 639 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 659 | button | <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left"> |
| `frontend/src/admin/CompactAdminPanel.tsx` | 667 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 668 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 669 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 670 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 671 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 672 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 684 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 685 | button | <button type="button" onClick={() => |
| `frontend/src/admin/CompactAdminPanel.tsx` | 693 | button | <button type="button" onClick={onClick} className={relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-bold transition active:scale-95 ${active ? 'bg-amber-300 text-neutral-950 shadow-[0_0_22px_rgba(251 |
| `frontend/src/admin/CompactAdminPanel.tsx` | 706 | button | <button type="button" disabled={disabled} onClick={onClick} className={rounded-2xl border px-3 py-3 text-sm font-black disabled:opacity-45 ${danger ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-white/15 bg-black/20 text-white/ |
| `frontend/src/director/DirectorAccessSettingsDock.tsx` | 127 | button | <button type="button" aria-label="Закрити" onClick={() => |
| `frontend/src/director/DirectorAccessSettingsDock.tsx` | 173 | button | <button type="button" onClick={() => |
| `frontend/src/director/DirectorAccessSettingsDock.tsx` | 181 | button | <button type="button" disabled={busy} onClick={() => |
| `frontend/src/director/DirectorAuthGate.tsx` | 226 | button | <button type="button" onClick={() => |
| `frontend/src/director/DirectorAuthGate.tsx` | 246 | button | <button type="submit" disabled={submitting &#124;&#124; !status?.directors.length} className="mt-5 w-full rounded-2xl border border-amber-200/45 bg-amber-300/15 px-4 py-3 text-sm font-black text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.1)] disable |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 322 | button | <button type="button" aria-label="Закрити" disabled={Boolean(busy)} onClick={closeManager} className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-100/30 bg-black/45 text-amber-100 transition active:scale-95 disabled:op |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 335 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 343 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 388 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 399 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 408 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 428 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 438 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 450 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 460 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 490 | button | <button type="button" disabled={Boolean(busy)} onClick={cancelPermanentDelete} className="rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-35" > |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 498 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorReviewArchiveControls.tsx` | 514 | button | <button type="button" onClick={openManager} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/35 bg-black/35 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-white/[0.025] act |
| `frontend/src/director/DirectorSiteControlsDock.tsx` | 170 | button | <button type="button" disabled={!restaurant &#124;&#124; Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorSiteControlsDock.tsx` | 207 | button | <button type="button" disabled={busy === 'phone' &#124;&#124; !phoneDirty} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 274 | button | <button type="button" aria-label="Закрити" disabled={Boolean(busy)} onClick={closeManager} className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-100/30 bg-black/45 text-cyan-100 transition active:scale-95 disabled:opac |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 287 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 295 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 322 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 332 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 352 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 362 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 374 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 384 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 414 | button | <button type="button" disabled={Boolean(busy)} onClick={cancelPermanentDelete} className="rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 disabled:opacity-35" > |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 422 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/director/DirectorStaffActionsArchiveControls.tsx` | 438 | button | <button type="button" onClick={openManager} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-100/35 bg-black/35 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-white/[0.025] activ |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 515 | button | <button type="button" onClick={openNotifications} aria-label="Повідомлення" className={relative grid h-11 w-11 place-items-center rounded-2xl border bg-black/45 text-rose-100 transition active:scale-95 ${unreadCount ? 'border-rose-100/80 s |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 569 | button | <button key={location.key} type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 589 | button | <button type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 605 | button | <button type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 636 | button | <button key={holiday.key} type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 674 | button | <button type="button" onClick={openAccessSettings} className="flex w-full items-center justify-between rounded-[24px] border border-amber-100/35 bg-black/50 p-4 text-left text-amber-50 shadow-[0_0_32px_rgba(251,191,36,.1)] transition active |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 710 | button | <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-100/30 bg-black/45 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.08)] transition  |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 715 | button | <button type="button" onClick={onClick} className={flex min-h-16 items-center justify-center gap-2 rounded-2xl border bg-black/55 px-2 text-xs font-black transition active:scale-[.98] ${style} ${active ? 'ring-1 ring-current' : 'opacity-85 |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 719 | button | <button type="button" onClick={onClick} className={flex min-w-[54px] flex-col items-center gap-1 rounded-2xl border bg-black/30 px-1 py-2 text-[9px] font-bold transition active:scale-95 sm:text-[10px] ${active ? 'border-amber-100/55 text-a |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 726 | button | <button type="button" onClick={onClick} className={w-full rounded-2xl border bg-black/40 p-4 text-left transition hover:bg-white/[0.025] active:scale-[.99] ${style}}> |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 738 | button | <button type="button" disabled={disabled} onClick={onClick} className={inline-flex items-center justify-center gap-2 rounded-2xl border bg-black/35 px-4 py-3 text-sm font-black transition hover:bg-white/[0.025] active:scale-[.985] disabled |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 742 | button | <button type="button" onClick={onClick} className={whitespace-nowrap rounded-2xl border bg-black/35 px-3 py-2.5 text-xs font-bold ${active ? 'border-amber-100/50 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.1)]' : 'border-white/10 text |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 760 | button | <button type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 764 | button | <button type="button" disabled={isSelf} onClick={onRemove} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200/30 bg-black/30 px-3 py-2.5 text-xs font-black text-rose-100 shadow-[0_0_16px_rgba(24 |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 823 | button | <button type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 824 | button | <button type="button" onClick={() => |
| `frontend/src/director/PremiumDirectorPanel.tsx` | 848 | button | <button key={client.id} type="button" onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 190 | button | <button type="button" title={connected ? Syrve підключено · ${status.organizationName &#124;&#124; 'організація'} : 'Налаштувати підключення Syrve'} aria-label={connected ? 'Syrve підключено. Відкрити налаштування' : 'Підключити Syrve'} onClick={() |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 210 | button | <button type="button" onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 235 | button | <button type="button" onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 239 | button | <button type="button" disabled={busy} onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 246 | button | <button key={organization.id} type="button" onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 248 | button | <button type="button" onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 248 | button | <button type="button" disabled={busy &#124;&#124; !organizationId} onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 259 | button | <button type="button" onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 266 | button | <button type="button" disabled={busy} onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 266 | button | <button type="button" disabled={busy} onClick={() => |
| `frontend/src/director/SyrveIntegrationDock.tsx` | 266 | button | <button type="button" disabled={busy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 518 | button | <button onClick={onClick} disabled={disabled} className="molo-button rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.16)] backdrop-blur-sm disabled:opaci |
| `frontend/src/guest/GuestApp.tsx` | 1400 | button | <button type="button" onClick={goBack} className="molo-button inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-black/30 px-4 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-md" > |
| `frontend/src/guest/GuestApp.tsx` | 1438 | button | <button type="button" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1448 | button | <button type="button" onClick={callAdmin} className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98]" > |
| `frontend/src/guest/GuestApp.tsx` | 1471 | a | <a href="https://t.me/AlexUlqiora" target="_blank" rel="noreferrer" aria-label="Telegram розробника Alex Ulquiorra" title="Розробник: Alex Ulquiorra" className="absolute bottom-[76px] right-2 z-20 rounded-2xl border border-white/10 bg-black |
| `frontend/src/guest/GuestApp.tsx` | 1517 | GoldButton | <GoldButton onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1521 | button | <button onClick={openMenu} className="molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] back |
| `frontend/src/guest/GuestApp.tsx` | 1529 | button | <button type="button" onClick={callAdmin} className="molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,19 |
| `frontend/src/guest/GuestApp.tsx` | 1558 | button | <button aria-label="Зал ресторану" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1564 | button | <button aria-label="Набережна ресторану" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1585 | button | <button onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1592 | button | <button onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1627 | button | <button key={location.key} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1659 | button | <button onClick={refreshMap} className="molo-button hidden rounded-full border border-amber-200/60 bg-black/20 px-4 py-2 text-sm text-amber-100 sm:inline-flex" > |
| `frontend/src/guest/GuestApp.tsx` | 1725 | button | <button type="button" onClick={openCustomDuration} className="molo-button rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80" > |
| `frontend/src/guest/GuestApp.tsx` | 1797 | button | <button type="button" onClick={closeTableNotice} className="rounded-2xl border border-amber-200/55 bg-amber-300/15 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/20" > |
| `frontend/src/guest/GuestApp.tsx` | 1805 | button | <button type="button" onClick={closeTableNotice} className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10" > |
| `frontend/src/guest/GuestApp.tsx` | 1973 | GoldButton | <GoldButton onClick={submit} disabled={loading}> |
| `frontend/src/guest/GuestApp.tsx` | 1983 | button | <button type="button" className="absolute inset-0" aria-label="Закрити мої бронювання" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 1997 | button | <button type="button" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2024 | button | <button type="button" disabled={guestActionBusy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2048 | button | <button type="button" disabled={guestActionBusy &#124;&#124; !booking.isLatenessPromptDue} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2074 | button | <button type="button" disabled={guestActionBusy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2103 | button | <button type="button" disabled={guestActionBusy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2121 | button | <button type="button" disabled={guestActionBusy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2144 | button | <button type="button" disabled={guestActionBusy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2181 | button | <button type="button" disabled={guestActionBusy} onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2203 | button | <button type="button" className="absolute inset-0" aria-label="Закрити пропозицію відгуку" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2220 | button | <button type="button" onClick={() => |
| `frontend/src/guest/GuestApp.tsx` | 2227 | a | <a href={MOLO_PUBLIC_REVIEW_URL} target="_blank" rel="noreferrer" onClick={openExternalReview} className="rounded-2xl border border-amber-200/65 bg-amber-300/15 px-4 py-3 text-sm font-black text-amber-100 shadow-[0_0_22px_rgba(251,191,36,.2 |
| `frontend/src/guest/GuestApp.tsx` | 2273 | button | <button type="button" onClick={callAdmin} className="mt-4 rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-3 text-sm font-bold text-amber-100 transition active:scale-95" > |
| `frontend/src/guest/GuestApp.tsx` | 2294 | button | <button type="button" onClick={callWaiter} disabled={waiterCallBusy} className="mt-4 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-4 text-base font-black text-amber-100 transition active:scale-95 disabled:opacity-60" |
| `frontend/src/guest/GuestApp.tsx` | 2339 | GoldButton | <GoldButton onClick={() => |
| `frontend/src/guest/GuestBookingServiceActions.tsx` | 387 | button | <button type="button" onClick={() => |
| `frontend/src/guest/GuestBookingServiceActions.tsx` | 399 | button | <button type="button" onClick={() => |
| `frontend/src/guest/GuestBookingServiceActions.tsx` | 420 | button | <button type="button" onClick={() => |
| `frontend/src/guest/GuestHookahCallPanel.tsx` | 184 | button | <button type="button" onClick={callHookahWorker} disabled={calling} className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98] disabled:cursor-not |
| `frontend/src/guest/GuestReviewDismissController.tsx` | 248 | button | <button type="button" onClick={() => |
| `frontend/src/guest/components/GuestBookingDecisionController.tsx` | 94 | button | <button type="button" disabled={busy} onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 205 | button | <button type="submit" disabled={ submitting &#124;&#124; loadingOptions &#124;&#124; options.length === 0 &#124;&#124; !selectedId } className="mt-5 w-full rounded-2xl border border-amber-100/70 bg-black/80 px-4 py-3 font-black text-amber-50 shadow-[0_0_24px_rgba(251,19 |
| `frontend/src/hookah/HookahApp.tsx` | 267 | button | <button key={value} type="button" onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 284 | button | <button type="button" onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 348 | button | <button type="button" onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 534 | button | <button type="button" onClick={logout} className="rounded-xl border border-white/25 bg-black/70 px-3 py-2 text-xs font-bold text-white/70 shadow-[0_0_14px_rgba(255,255,255,.08)]" > |
| `frontend/src/hookah/HookahApp.tsx` | 550 | button | <button type="button" onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 564 | button | <button type="button" onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 576 | button | <button type="button" onClick={() => |
| `frontend/src/hookah/HookahApp.tsx` | 631 | button | <button type="button" onClick={() => |
| `frontend/src/staff/TelegramStaffInvitePanel.tsx` | 218 | button | <button type="submit" disabled={creatingAdmin} className="mt-4 w-full rounded-2xl border border-amber-200/35 bg-amber-300/10 px-4 py-3 font-black text-amber-100 disabled:opacity-40" > |
| `frontend/src/staff/TelegramStaffInvitePanel.tsx` | 249 | button | <button type="button" disabled={linked &#124;&#124; busyId === member.id} onClick={() => |
| `frontend/src/telegram/TelegramStaffLinkGate.tsx` | 153 | button | <button type="submit" disabled={ submitting &#124;&#124; (info.authType === 'pin' ? !/^\d{4,6}$/.test(pin) : !password.trim()) } className="w-full rounded-2xl bg-sky-200 px-4 py-3 font-black text-neutral-950 transition active:scale-[0.98] disabled:op |
| `frontend/src/waiter/WaiterAppV2.tsx` | 114 | button | <button disabled={busy &#124;&#124; !staffId} className="mt-6 w-full rounded-2xl border border-amber-200/65 bg-amber-300/15 p-4 font-black text-amber-100 shadow-[0_0_28px_rgba(250,204,21,.16)] transition active:scale-[.98] disabled:opacity-40"> |
| `frontend/src/waiter/WaiterAppV2.tsx` | 196 | button | <button type="button" onClick={() => |
| `frontend/src/waiter/WaiterAppV2.tsx` | 200 | button | <button key={key} type="button" onClick={() => |
| `frontend/src/waiter/WaiterAppV2.tsx` | 203 | button | <button type="button" onClick={() => |
| `frontend/src/waiter/WaiterAppV2.tsx` | 213 | button | <button type="button" disabled={Boolean(busy) &#124;&#124; call.status === 'accepted'} onClick={() => |
| `frontend/src/waiter/WaiterAppV2.tsx` | 213 | button | <button type="button" disabled={Boolean(busy) &#124;&#124; call.status !== 'accepted'} onClick={() => |
| `frontend/src/waiter/WaiterAppV2.tsx` | 235 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/waiter/WaiterAppV2.tsx` | 242 | button | <button type="button" onClick={logout} className="mt-5 w-full rounded-2xl border border-white/10 bg-white/[.03] p-3 text-sm font-bold text-white/45"> |
| `frontend/src/waiter/WaiterCallAlertController.tsx` | 320 | button | <button type="button" onClick={toggleSound} aria-label={soundEnabled ? 'Вимкнути звук викликів' : 'Увімкнути звук викликів'} title={soundEnabled ? 'Вимкнути звук викликів' : 'Увімкнути звук викликів'} className={fixed top-5 z-[70] inline-f |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 104 | button | <button key={table.id} type="button" onClick={() => |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 128 | button | <button type="button" onClick={() => |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 129 | button | <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[.04] text-white/75"> |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 134 | button | <button key={location.key} type="button" onClick={() => |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 143 | button | <button type="button" onClick={() => |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 167 | button | <button type="button" onClick={onClose} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.03] p-4 font-black text-white/60"> |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 175 | button | <button type="button" onClick={() => |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 178 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
| `frontend/src/waiter/WaiterTablesByLocation.tsx` | 179 | button | <button type="button" disabled={Boolean(busy)} onClick={() => |
