from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        if new in text:
            print(f"already patched: {path}")
            return
        raise RuntimeError(f"expected block not found in {path}")
    file.write_text(text.replace(old, new, 1))
    print(f"patched: {path}")


def sub_once(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=re.S)
    if count == 0:
        if replacement in text:
            print(f"already patched: {path}")
            return
        raise RuntimeError(f"pattern not found in {path}: {pattern[:80]}")
    file.write_text(updated)
    print(f"patched: {path}")


replace_once(
    "backend/src/bookings/bookings.controller.ts",
    """  checkIn(@Param('id') id: string) {
    return this.service.checkIn(id);
  }
""",
    """  checkIn(@Param('id') id: string, @Req() request: any) {
    return this.service.checkIn(id, request.user);
  }
""",
)

replace_once(
    "backend/src/bookings/bookings.controller.ts",
    """  @Public()
  @Patch(':id/guest/change-table')
""",
    """  @Public()
  @Patch(':id/guest/change-time')
  guestChangeTime(
    @Param('id') id: string,
    @Headers('x-guest-booking-token') token: string,
    @Body() dto: RequestRescheduleDto,
  ) {
    return this.guestService.requestTimeChange(id, token, dto);
  }

  @Public()
  @Patch(':id/guest/change-table')
""",
)

replace_once(
    "backend/src/bookings/bookings.service.ts",
    """  private async saveHistory(
    booking: Booking,
    action: string,
    actorRole: string,
    previousData?: Record<string, unknown> | null,
    newData?: Record<string, unknown> | null,
    reason?: string | null,
  ) {
    await this.histories.save(
      this.histories.create({
        booking,
        action,
        actorRole,
        actorStaffId: null,
        actorName: null,
        previousData: previousData || null,
        newData: newData || null,
        reason: reason || null,
        isManualMode: false,
      }),
    );
  }
""",
    """  private async saveHistory(
    booking: Booking,
    action: string,
    actorRole: string,
    previousData?: Record<string, unknown> | null,
    newData?: Record<string, unknown> | null,
    reason?: string | null,
    actor?: AuthUser | null,
  ) {
    await this.histories.save(
      this.histories.create({
        booking,
        action,
        actorRole,
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData: previousData || null,
        newData: newData || null,
        reason: reason || null,
        isManualMode: false,
      }),
    );
  }
""",
)

replace_once(
    "backend/src/bookings/bookings.service.ts",
    """  async getByDate(date: string) {
    const bookingDate = this.normalizeBookingDate(date);

    return this.bookings.find({
      where: { bookingDate },
      relations: ['table', 'table.zone', 'client'],
      order: { bookingTime: 'ASC', createdAt: 'DESC' },
      take: 1000,
    });
  }
""",
    """  async getByDate(date: string) {
    const bookingDate = this.normalizeBookingDate(date);
    const bookings = await this.bookings.find({
      where: { bookingDate },
      relations: ['table', 'table.zone', 'client'],
      order: { bookingTime: 'ASC', createdAt: 'DESC' },
      take: 1000,
    });

    if (!bookings.length) return bookings;

    const assignmentEvents = await this.histories
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.booking', 'booking')
      .where('booking.id IN (:...bookingIds)', {
        bookingIds: bookings.map((booking) => booking.id),
      })
      .andWhere('history.action IN (:...actions)', {
        actions: ['booking_checked_in', 'waiter_table_transfer'],
      })
      .orderBy('history.createdAt', 'DESC')
      .getMany();

    const latestAssignmentEvent = new Map<string, BookingHistory>();
    for (const event of assignmentEvents) {
      if (!latestAssignmentEvent.has(event.booking.id)) {
        latestAssignmentEvent.set(event.booking.id, event);
      }
    }

    return bookings.map((booking) => {
      const event = latestAssignmentEvent.get(booking.id);
      const hasAssignedWaiter =
        event?.action === 'booking_checked_in' &&
        event.actorRole === 'waiter' &&
        Boolean(event.actorStaffId);

      return Object.assign(booking, {
        assignedWaiterId: hasAssignedWaiter ? event?.actorStaffId || null : null,
        assignedWaiterName: hasAssignedWaiter ? event?.actorName || null : null,
      });
    });
  }
""",
)

replace_once(
    "backend/src/bookings/bookings.service.ts",
    """  async checkIn(id: string) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    if (!booking.checkedInAt) booking.checkedInAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_checked_in', 'admin', previousData, this.bookingSnapshot(booking));
    await this.setTableStatusOnlyForToday(booking.table, 'occupied', booking.bookingDate, true);
    await this.safeLog('Гості прийшли', { bookingId: id });
    return { message: 'Гості відмічені як присутні' };
  }
""",
    """  async checkIn(id: string, actor?: AuthUser) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    if (!booking.checkedInAt) booking.checkedInAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(
      booking,
      'booking_checked_in',
      actor?.role || 'admin',
      previousData,
      this.bookingSnapshot(booking),
      null,
      actor || null,
    );
    await this.setTableStatusOnlyForToday(booking.table, 'occupied', booking.bookingDate, true);
    await this.safeLog('Гості прийшли', {
      bookingId: id,
      waiterId: actor?.staffId || null,
      waiterName: actor?.name || null,
    });
    return { message: 'Гості відмічені як присутні' };
  }
""",
)

replace_once(
    "backend/src/bookings/guest-bookings.service.ts",
    """import { GuestReviewDto } from './dto/guest-review.dto';
import { BookingHistory } from './entities/booking-history.entity';
""",
    """import { GuestReviewDto } from './dto/guest-review.dto';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { BookingHistory } from './entities/booking-history.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
""",
)

replace_once(
    "backend/src/bookings/guest-bookings.service.ts",
    """  async changeTable(id: string, token: string, dto: GuestChangeTableDto) {
""",
    """  async requestTimeChange(id: string, token: string, dto: RequestRescheduleDto) {
    await this.dataSource.transaction(async (manager) => {
      const booking = await this.findOwnedBooking(id, token, manager, true);
      this.assertGuestCanManageActiveBooking(
        booking,
        'Зміна часу для цієї броні вже недоступна',
      );

      const requestedDate = String(dto.requestedDate || '').trim();
      const requestedTime = String(dto.requestedTime || '').trim();
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(requestedDate)) {
        throw new BadRequestException('Вкажіть дату у форматі YYYY-MM-DD');
      }
      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(requestedTime)) {
        throw new BadRequestException('Вкажіть час у форматі ГГ:ХХ');
      }
      if (requestedDate < this.kyivDate()) {
        throw new BadRequestException('Не можна перенести бронювання на минулу дату');
      }

      const repository = manager.getRepository(BookingRescheduleRequest);
      let request = await repository.findOne({
        where: {
          booking: { id: booking.id },
          status: 'pending',
        } as any,
        relations: ['booking'],
      });

      if (request) {
        request.requestedDate = requestedDate;
        request.requestedTime = requestedTime;
      } else {
        request = repository.create({
          booking,
          requestedDate,
          requestedTime,
          status: 'pending',
          adminComment: null,
          resolvedAt: null,
        });
      }
      await repository.save(request);

      await this.saveHistory(manager, booking, 'guest_requested_time_change', {
        newData: { requestedDate, requestedTime },
        reason: `Новий час: ${requestedDate} ${requestedTime}`,
      });
    });

    return {
      message: 'Запит на зміну часу надіслано адміністратору',
      booking: await this.get(id, token),
    };
  }

  async changeTable(id: string, token: string, dto: GuestChangeTableDto) {
""",
)

replace_once(
    "backend/src/bookings/guest-bookings.service.ts",
    """  private payload(booking: Booking, reviewExists: boolean, restaurantPhone: string | null) {
    const canManage = ACTIVE_BOOKING_STATUSES.includes(booking.status) && !booking.checkedInAt;
    const expectedArrivalOverdue = Boolean(
""",
    """  private payload(booking: Booking, reviewExists: boolean, restaurantPhone: string | null) {
    const canManage = ACTIVE_BOOKING_STATUSES.includes(booking.status) && !booking.checkedInAt;
    const canReportLateness = Boolean(
      booking.status === 'approved' &&
        !booking.checkedInAt &&
        !booking.lateNotifiedAt &&
        this.isToday(booking.bookingDate),
    );
    const expectedArrivalOverdue = Boolean(
""",
)

replace_once(
    "backend/src/bookings/guest-bookings.service.ts",
    """      canGuestCancel: canManage,
      canGuestChangeTable: canManage,
      canLeaveReview: booking.status === 'completed' && Boolean(booking.checkedInAt) && !reviewExists,
""",
    """      canGuestCancel: canManage,
      canGuestChangeTable: canManage,
      canGuestChangeTime: canManage,
      canReportLateness,
      canLeaveReview: booking.status === 'completed' && Boolean(booking.checkedInAt) && !reviewExists,
""",
)

replace_once(
    "frontend/src/api/types.ts",
    """  checkedInAt?: string | null;
  noShowAlertSentAt?: string | null;
""",
    """  checkedInAt?: string | null;
  assignedWaiterId?: string | null;
  assignedWaiterName?: string | null;
  noShowAlertSentAt?: string | null;
""",
)

replace_once(
    "frontend/src/api/bookings.ts",
    """  canGuestCancel?: boolean;
  canGuestChangeTable?: boolean;
  canLeaveReview?: boolean;
""",
    """  canGuestCancel?: boolean;
  canGuestChangeTable?: boolean;
  canGuestChangeTime?: boolean;
  canReportLateness?: boolean;
  canLeaveReview?: boolean;
""",
)

replace_once(
    "frontend/src/api/bookings.ts",
    """  canGuestCancel?: boolean;
  canGuestChangeTable?: boolean;
  canLeaveReview?: boolean;
  guestNotification?: {
""",
    """  canGuestCancel?: boolean;
  canGuestChangeTable?: boolean;
  canGuestChangeTime?: boolean;
  canReportLateness?: boolean;
  canLeaveReview?: boolean;
  guestNotification?: {
""",
)

replace_once(
    "frontend/src/api/bookings.ts",
    """  guestLateness: (id: string, token: string, hours: number, minutes: number) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/lateness`, { hours, minutes }, { headers: guestHeaders(token) }),

  guestChangeTable: (id: string, token: string, table: { tableId?: string; tableNumber?: string }) =>
""",
    """  guestLateness: (id: string, token: string, hours: number, minutes: number) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/lateness`, { hours, minutes }, { headers: guestHeaders(token) }),

  guestChangeTime: (
    id: string,
    token: string,
    payload: { requestedDate: string; requestedTime: string },
  ) =>
    api.patch<ActionResponse>(`/bookings/${encode(id)}/guest/change-time`, payload, { headers: guestHeaders(token) }),

  guestChangeTable: (id: string, token: string, table: { tableId?: string; tableNumber?: string }) =>
""",
)

replace_once(
    "frontend/src/waiter/WaiterApp.tsx",
    """import {
  waiterCallsApi,
  type WaiterAssignment,
  type WaiterCall,
} from "../api/waiterCalls";
""",
    """import {
  waiterCallsApi,
  type WaiterCall,
} from "../api/waiterCalls";
""",
)

replace_once(
    "frontend/src/waiter/WaiterApp.tsx",
    """  const [assignments, setAssignments] = useState<WaiterAssignment[]>([]);
""",
    """""",
)

replace_once(
    "frontend/src/waiter/WaiterApp.tsx",
    """      const [b, c, a] = await Promise.all([
        bookingsApi.getToday(),
        waiterCallsApi.list(),
        waiterCallsApi.assignments(),
      ]);
      setBookings(b);
      setCalls(c);
      setAssignments(a);
""",
    """      const [b, c] = await Promise.all([
        bookingsApi.getToday(),
        waiterCallsApi.list(),
      ]);
      setBookings(b);
      setCalls(c);
""",
)

replace_once(
    "frontend/src/waiter/WaiterApp.tsx",
    """  const mine = useMemo(() => {
    const ids = new Set(
      assignments
        .filter((a) => a.waiterId === staff?.id)
        .map((a) => a.bookingId),
    );
    return active.filter((b) => ids.has(b.id));
  }, [active, assignments, staff]);
""",
    """  const mine = useMemo(
    () => active.filter((booking) => booking.assignedWaiterId === staff?.id),
    [active, staff?.id],
  );
  const transferGroups = useMemo(() => {
    const groups = new Map<string, TableItem[]>();
    for (const table of tables) {
      const location = table.zone?.name?.trim() || 'Без локації';
      const items = groups.get(location) || [];
      items.push(table);
      groups.set(location, items);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'uk'))
      .map(([location, items]) => ({
        location,
        tables: [...items].sort((left, right) => {
          const leftNumber = Number(left.tableNumber);
          const rightNumber = Number(right.tableNumber);
          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
          }
          return String(left.tableNumber).localeCompare(String(right.tableNumber), 'uk');
        }),
      }));
  }, [tables]);
""",
)

replace_once(
    "frontend/src/waiter/WaiterApp.tsx",
    """                            () =>
                              bookingsApi
                                .checkIn(b.id)
                                .then(() =>
                                  waiterCallsApi.assign({
                                    bookingId: b.id,
                                    tableId: b.table?.id,
                                    tableNumber: b.table?.tableNumber,
                                  }),
                                ),
""",
    """                            () =>
                              bookingsApi.checkIn(b.id).then(async () => {
                                try {
                                  await waiterCallsApi.assign({
                                    bookingId: b.id,
                                    tableId: b.table?.id,
                                    tableNumber: b.table?.tableNumber,
                                  });
                                } catch {
                                  // The database-backed check-in still keeps the table in "Мої столи".
                                }
                              }),
""",
)

sub_once(
    "frontend/src/waiter/WaiterApp.tsx",
    r"""              <div className="mt-4 grid grid-cols-2 gap-2">\n                \{tables\.map\(\(t\) => \(.*?\n                \)\)\}\n              </div>""",
    """              <div className="mt-4 space-y-5">
                {transferGroups.map((group) => (
                  <section key={group.location}>
                    <h3 className="mb-2 text-sm font-black uppercase tracking-[.16em] text-amber-100/75">
                      {group.location}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {group.tables.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            if (
                              confirm(
                                `Пересадити гостей зі столу №${transfer.table?.tableNumber} на стіл №${t.tableNumber}?`,
                              )
                            )
                              act(`t${transfer.id}`, () =>
                                bookingsApi
                                  .waiterTransfer(transfer.id, t.id)
                                  .then(() => setTransfer(null)),
                              );
                          }}
                          className="rounded-2xl border border-white/20 bg-black/30 p-4 text-left active:scale-95"
                        >
                          <b>Стіл №{t.tableNumber}</b>
                          <span className="block text-sm text-white/55">
                            до {t.seats} місць
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>""",
)

replace_once(
    "frontend/src/guest/GuestApp.tsx",
    """          const booking =
            bookings.find((item) => item.bookingId === lastBookingId) ||
            bookings.find((item) => item.status === 'pending' || item.status === 'approved');
""",
    """          const activeBookings = bookings.filter(
            (item) => item.status === 'pending' || item.status === 'approved',
          );
          const booking =
            activeBookings.find((item) => item.bookingId === lastBookingId) ||
            activeBookings[0] ||
            bookings.find((item) => item.bookingId === lastBookingId);
""",
)

replace_once(
    "frontend/src/guest/GuestApp.tsx",
    """  async function runGuestAction(bookingId: string, token: string, action: (token: string) => Promise<{ message: string; booking?: GuestBooking; askExternalReview?: boolean }>) {
    if (!bookingId || !token || guestActionBusy) return null;

    setGuestActionBusy(true);
""",
    """  async function runGuestAction(bookingId: string, token: string, action: (token: string) => Promise<{ message: string; booking?: GuestBooking; askExternalReview?: boolean }>) {
    if (!bookingId || !token || guestActionBusy) return null;

    setLastBookingId(bookingId);
    setGuestActionBusy(true);
""",
)

sub_once(
    "frontend/src/guest/GuestApp.tsx",
    r"""                  \{access && booking\.status !== 'cancelled' && \(\n                    <div className="mt-3 grid gap-2 sm:grid-cols-3">.*?\n                    </div>\n                  \)\}""",
    """                  {access && booking.status !== 'cancelled' && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {booking.canReportLateness && (
                        <button
                          type="button"
                          disabled={guestActionBusy || !booking.isLatenessPromptDue}
                          onClick={() => {
                            const minutes = Number(window.prompt('На скільки хвилин ви запізнюєтеся?', '15'));
                            if (Number.isInteger(minutes) && minutes > 0 && minutes <= 720) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestLateness(
                                  booking.bookingId,
                                  token,
                                  Math.floor(minutes / 60),
                                  minutes % 60,
                                ),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-45"
                        >
                          {booking.isLatenessPromptDue
                            ? 'Повідомити про запізнення'
                            : `Запізнююсь — доступно після ${String(booking.bookingTime).slice(0, 5)}`}
                        </button>
                      )}
                      {booking.canGuestChangeTime && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            const requestedTime = window.prompt(
                              'Вкажіть новий час у форматі ГГ:ХХ',
                              String(booking.bookingTime).slice(0, 5),
                            );
                            if (requestedTime?.trim()) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestChangeTime(
                                  booking.bookingId,
                                  token,
                                  {
                                    requestedDate: booking.bookingDate,
                                    requestedTime: requestedTime.trim(),
                                  },
                                ),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                        >
                          Змінити час
                        </button>
                      )}
                      {booking.canGuestCancel && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            if (window.confirm('Скасувати це бронювання?')) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestCancel(booking.bookingId, token),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                        >
                          Скасувати бронювання
                        </button>
                      )}
                      {booking.canGuestChangeTable && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            const tableNumber = window.prompt('Вкажіть номер нового столу');
                            if (tableNumber?.trim()) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestChangeTable(
                                  booking.bookingId,
                                  token,
                                  { tableNumber: tableNumber.trim() },
                                ),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                        >
                          Змінити стіл
                        </button>
                      )}
                      {booking.canLeaveReview && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            const text = window.prompt('Поділіться враженнями від візиту');
                            if (text?.trim()) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestReview(
                                  booking.bookingId,
                                  token,
                                  { text: text.trim() },
                                ),
                              ).then((result) => {
                                if (result?.askExternalReview) {
                                  setLastBookingId(booking.bookingId);
                                  try {
                                    setShowExternalReviewOffer(
                                      window.sessionStorage.getItem(
                                        `${EXTERNAL_REVIEW_SESSION_KEY_PREFIX}${booking.bookingId}`,
                                      ) !== 'true',
                                    );
                                  } catch {
                                    setShowExternalReviewOffer(true);
                                  }
                                }
                              });
                            }
                          }}
                          className="rounded-xl border border-emerald-200/35 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-100 disabled:opacity-50"
                        >
                          Залишити відгук
                        </button>
                      )}
                    </div>
                  )}""",
)

print("All waiter and guest fixes applied")
