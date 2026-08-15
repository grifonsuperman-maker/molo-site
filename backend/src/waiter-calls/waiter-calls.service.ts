import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';

import { BookingHistory } from '../bookings/entities/booking-history.entity';
import { Booking } from '../bookings/entities/booking.entity';
import {
  WaiterCallRecord,
  type WaiterCallStatus,
} from './entities/waiter-call.entity';

export type WaiterCall = {
  id: string;
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  clientName: string | null;
  waiterId: string | null;
  waiterName: string | null;
  status: WaiterCallStatus;
  createdAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
};

type WaiterAssignment = {
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  waiterId: string;
  waiterName: string;
  assignedAt: string;
};

type PersistedAssignmentRow = {
  bookingId: string;
  tableId: string | null;
  tableNumber: string | null;
  waiterId: string;
  waiterName: string | null;
  assignedAt: Date | string;
};

const WAITER_ASSIGNMENT_HISTORY_ACTIONS = [
  'booking_checked_in',
  'waiter_table_transfer',
];
const ACTIVE_CALL_STATUSES: WaiterCallStatus[] = ['new', 'accepted'];

@Injectable()
export class WaiterCallsService {
  private assignments: WaiterAssignment[] = [];

  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingHistory)
    private readonly histories: Repository<BookingHistory>,
    @InjectRepository(WaiterCallRecord)
    private readonly callRecords: Repository<WaiterCallRecord>,
    private readonly dataSource: DataSource,
  ) {}

  private now() {
    return new Date().toISOString();
  }

  private makeId() {
    return `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  private dateText(value: Date | string) {
    return typeof value === 'string' ? value : value.toISOString();
  }

  private nullableDateText(value: Date | string | null | undefined) {
    return value ? this.dateText(value) : null;
  }

  private toPublicCall(call: WaiterCallRecord): WaiterCall {
    return {
      id: call.id,
      bookingId: call.booking.id,
      tableId: call.tableId,
      tableNumber: call.tableNumber,
      clientName: call.clientName,
      waiterId: call.waiterId,
      waiterName: call.waiterName,
      status: call.status,
      createdAt: this.dateText(call.createdAt),
      acceptedAt: this.nullableDateText(call.acceptedAt),
      closedAt: this.nullableDateText(call.closedAt),
    };
  }

  private toAssignment(call: WaiterCallRecord): WaiterAssignment | null {
    if (!call.waiterId || !call.assignmentActive) return null;
    return {
      bookingId: call.booking.id,
      tableId: call.tableId,
      tableNumber: call.tableNumber,
      waiterId: call.waiterId,
      waiterName: call.waiterName || 'Офіціант',
      assignedAt:
        this.nullableDateText(call.acceptedAt) || this.dateText(call.createdAt),
    };
  }

  private async getBooking(
    bookingId: string,
    repository: Repository<Booking> = this.bookings,
  ) {
    const booking = await repository.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });

    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    return booking;
  }

  private async assertGuestAccess(
    bookingId: string,
    guestToken: string | undefined,
    repository: Repository<Booking> = this.bookings,
  ) {
    const normalizedToken = String(guestToken || '').trim();
    if (!normalizedToken || normalizedToken.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    const guestAccessTokenHash = createHash('sha256')
      .update(normalizedToken)
      .digest('hex');
    const hasAccess = await repository.exist({
      where: { id: bookingId, guestAccessTokenHash },
    });

    if (!hasAccess) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }
  }

  private async getGuestBooking(bookingId: string, guestToken?: string) {
    await this.assertGuestAccess(bookingId, guestToken);
    return this.getBooking(bookingId);
  }

  private rememberAssignment(assignment: WaiterAssignment) {
    this.assignments = this.assignments.filter(
      (item) =>
        item.bookingId !== assignment.bookingId &&
        (!assignment.tableId || item.tableId !== assignment.tableId) &&
        (!assignment.tableNumber || item.tableNumber !== assignment.tableNumber),
    );

    this.assignments.push(assignment);
    return assignment;
  }

  private findAssignment(booking: Booking) {
    const tableId = booking.table?.id || null;
    const tableNumber = booking.table?.tableNumber || null;

    return [...this.assignments]
      .reverse()
      .find((assignment) => {
        if (assignment.bookingId === booking.id) return true;
        if (tableId && assignment.tableId === tableId) return true;
        if (tableNumber && assignment.tableNumber === tableNumber) return true;
        return false;
      }) || null;
  }

  private async persistedCallAssignment(bookingId: string) {
    const call = await this.callRecords.findOne({
      where: {
        booking: { id: bookingId },
        waiterId: Not(IsNull()),
        assignmentActive: true,
      },
      relations: { booking: true },
      order: { acceptedAt: 'DESC', createdAt: 'DESC' },
    });

    return call ? this.toAssignment(call) : null;
  }

  private async resolveAssignment(booking: Booking) {
    const inMemoryAssignment = this.findAssignment(booking);
    if (inMemoryAssignment) return inMemoryAssignment;

    const persistedCallAssignment = await this.persistedCallAssignment(
      booking.id,
    );
    if (persistedCallAssignment) {
      return this.rememberAssignment(persistedCallAssignment);
    }

    const latestAssignmentEvent = await this.histories
      .createQueryBuilder('history')
      .leftJoin('history.booking', 'booking')
      .where('booking.id = :bookingId', { bookingId: booking.id })
      .andWhere('history.action IN (:...actions)', {
        actions: WAITER_ASSIGNMENT_HISTORY_ACTIONS,
      })
      .orderBy('history.createdAt', 'DESC')
      .getOne();

    const hasPersistedWaiter =
      latestAssignmentEvent?.action === 'booking_checked_in' &&
      latestAssignmentEvent.actorRole === 'waiter' &&
      Boolean(latestAssignmentEvent.actorStaffId);

    if (!latestAssignmentEvent || !hasPersistedWaiter) return null;

    return this.rememberAssignment({
      bookingId: booking.id,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      waiterId: latestAssignmentEvent.actorStaffId as string,
      waiterName: latestAssignmentEvent.actorName || 'Офіціант',
      assignedAt: latestAssignmentEvent.createdAt.toISOString(),
    });
  }

  private async activeCallForBooking(
    bookingId: string,
    repository: Repository<WaiterCallRecord> = this.callRecords,
  ) {
    return repository.findOne({
      where: {
        booking: { id: bookingId },
        status: In(ACTIVE_CALL_STATUSES),
      },
      relations: { booking: true },
      order: { createdAt: 'DESC' },
    });
  }

  private async buildGuestStatus(booking: Booking) {
    const tableStatus = booking.table?.status || null;
    const canCall = booking.status === 'approved' && tableStatus === 'occupied';
    const activeCall = await this.activeCallForBooking(booking.id);
    const assignment = await this.resolveAssignment(booking);

    return {
      bookingId: booking.id,
      tableNumber: booking.table?.tableNumber || null,
      bookingStatus: booking.status,
      tableStatus,
      canCall,
      waiterAssigned: Boolean(assignment),
      waiterName: assignment?.waiterName || null,
      activeCall: activeCall ? this.toPublicCall(activeCall) : null,
    };
  }

  async assignmentForBooking(booking: Booking) {
    return this.resolveAssignment(booking);
  }

  async assign(dto: {
    bookingId: string;
    tableId?: string | null;
    tableNumber?: string | null;
    waiterId: string;
    waiterName: string;
  }) {
    if (!dto.bookingId) throw new BadRequestException('bookingId обовʼязковий');
    if (!dto.waiterId) throw new BadRequestException('waiterId обовʼязковий');

    const booking = await this.getBooking(dto.bookingId);

    const assignment = this.rememberAssignment({
      bookingId: booking.id,
      tableId: dto.tableId || booking.table?.id || null,
      tableNumber: dto.tableNumber || booking.table?.tableNumber || null,
      waiterId: dto.waiterId,
      waiterName: dto.waiterName || 'Офіціант',
      assignedAt: this.now(),
    });

    return {
      message: 'Офіціанта закріплено за столом',
      assignment,
    };
  }

  async guestStatus(bookingId: string, guestToken?: string) {
    const booking = await this.getGuestBooking(bookingId, guestToken);
    return this.buildGuestStatus(booking);
  }

  async createFromGuest(dto: { bookingId: string }, guestToken?: string) {
    if (!dto.bookingId) throw new BadRequestException('bookingId обовʼязковий');

    try {
      return await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const callRepo = manager.getRepository(WaiterCallRecord);

        await this.assertGuestAccess(dto.bookingId, guestToken, bookingRepo);

        const lockedBooking = await bookingRepo
          .createQueryBuilder('booking')
          .where('booking.id = :bookingId', { bookingId: dto.bookingId })
          .setLock('pessimistic_write', undefined, ['booking'])
          .getOne();

        if (!lockedBooking) throw new NotFoundException('Бронювання не знайдено');

        const booking = await this.getBooking(dto.bookingId, bookingRepo);
        const tableStatus = booking.table?.status || null;
        const canCall = booking.status === 'approved' && tableStatus === 'occupied';

        if (!canCall) {
          throw new BadRequestException('Виклик офіціанта доступний тільки після приходу гостя за стіл');
        }

        const existing = await this.activeCallForBooking(booking.id, callRepo);
        if (existing) {
          return {
            message: 'Виклик вже відправлено',
            call: this.toPublicCall(existing),
          };
        }

        const assignment = await this.resolveAssignment(booking);
        const call = callRepo.create({
          id: this.makeId(),
          booking,
          tableId: booking.table?.id || null,
          tableNumber: booking.table?.tableNumber || null,
          clientName: booking.client?.fullName || null,
          waiterId: assignment?.waiterId || null,
          waiterName: assignment?.waiterName || null,
          assignmentActive: true,
          status: 'new',
          acceptedAt: null,
          closedAt: null,
        });

        const saved = await callRepo.save(call);
        return {
          message: assignment
            ? `Виклик відправлено офіціанту ${assignment.waiterName}`
            : 'Виклик відправлено у загальний список офіціантів',
          call: this.toPublicCall(saved),
        };
      });
    } catch (error: any) {
      const code = error?.code || error?.driverError?.code;
      const constraint = error?.constraint || error?.driverError?.constraint;
      if (code === '23505' && constraint === 'UQ_waiter_calls_active_booking') {
        const concurrent = await this.activeCallForBooking(dto.bookingId);
        if (concurrent) {
          return {
            message: 'Виклик вже відправлено',
            call: this.toPublicCall(concurrent),
          };
        }
      }
      throw error;
    }
  }

  async list(waiterId?: string) {
    const records = await this.callRecords.find({
      where: { status: In(ACTIVE_CALL_STATUSES) },
      relations: { booking: true },
      order: { createdAt: 'DESC' },
    });
    const active = records.map((call) => this.toPublicCall(call));

    if (!waiterId) return active;
    return active.filter((call) => !call.waiterId || call.waiterId === waiterId);
  }

  async myAssignments(waiterId: string) {
    if (!waiterId) return [];

    const inMemory = [...this.assignments]
      .filter((assignment) => assignment.waiterId === waiterId)
      .reverse();
    const rows = await this.callRecords.query(
      `
        WITH latest_per_booking AS (
          SELECT
            waiter_calls.*,
            ROW_NUMBER() OVER (
              PARTITION BY waiter_calls.booking_id
              ORDER BY COALESCE(waiter_calls.accepted_at, waiter_calls.created_at) DESC,
                       waiter_calls.created_at DESC
            ) AS booking_rank
          FROM waiter_calls
          INNER JOIN bookings
            ON bookings.id = waiter_calls.booking_id
          WHERE waiter_calls.waiter_id = $1
            AND waiter_calls.assignment_active = true
            AND bookings.status = 'approved'
            AND bookings.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Kyiv')::date
        ),
        latest_per_table AS (
          SELECT
            latest_per_booking.*,
            ROW_NUMBER() OVER (
              PARTITION BY CASE
                WHEN latest_per_booking.table_id IS NOT NULL
                  THEN 'id:' || latest_per_booking.table_id::text
                WHEN latest_per_booking.table_number IS NOT NULL
                  THEN 'number:' || latest_per_booking.table_number
                ELSE 'booking:' || latest_per_booking.booking_id::text
              END
              ORDER BY COALESCE(latest_per_booking.accepted_at, latest_per_booking.created_at) DESC,
                       latest_per_booking.created_at DESC
            ) AS table_rank
          FROM latest_per_booking
          WHERE latest_per_booking.booking_rank = 1
        )
        SELECT
          latest_per_table.booking_id AS "bookingId",
          latest_per_table.table_id AS "tableId",
          latest_per_table.table_number AS "tableNumber",
          latest_per_table.waiter_id AS "waiterId",
          latest_per_table.waiter_name AS "waiterName",
          COALESCE(latest_per_table.accepted_at, latest_per_table.created_at) AS "assignedAt"
        FROM latest_per_table
        WHERE latest_per_table.table_rank = 1
        ORDER BY "assignedAt" DESC
        LIMIT 50
      `,
      [waiterId],
    ) as PersistedAssignmentRow[];
    const persisted = rows.map((row) => ({
      bookingId: row.bookingId,
      tableId: row.tableId,
      tableNumber: row.tableNumber,
      waiterId: row.waiterId,
      waiterName: row.waiterName || 'Офіціант',
      assignedAt: this.dateText(row.assignedAt),
    }));
    const seenBookings = new Set<string>();
    const seenTableIds = new Set<string>();
    const seenTableNumbers = new Set<string>();

    return [...inMemory, ...persisted]
      .filter((assignment) => {
        if (seenBookings.has(assignment.bookingId)) return false;
        if (assignment.tableId && seenTableIds.has(assignment.tableId)) return false;
        if (
          assignment.tableNumber &&
          seenTableNumbers.has(assignment.tableNumber)
        ) {
          return false;
        }

        seenBookings.add(assignment.bookingId);
        if (assignment.tableId) seenTableIds.add(assignment.tableId);
        if (assignment.tableNumber) seenTableNumbers.add(assignment.tableNumber);
        return true;
      })
      .slice(0, 50);
  }

  detachBooking(bookingId: string) {
    this.assignments = this.assignments.filter((assignment) => assignment.bookingId !== bookingId);
  }

  /** Invalidates active guest calls after the booking has been moved to another table. */
  async closeActiveCallsAndDetachBooking(bookingId: string) {
    const closedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const callRepo = manager.getRepository(WaiterCallRecord);

      await callRepo
        .createQueryBuilder()
        .update(WaiterCallRecord)
        .set({ status: 'closed', closedAt })
        .where('"booking_id" = :bookingId', { bookingId })
        .andWhere('"status" IN (:...statuses)', { statuses: ACTIVE_CALL_STATUSES })
        .execute();

      await callRepo
        .createQueryBuilder()
        .update(WaiterCallRecord)
        .set({ assignmentActive: false })
        .where('"booking_id" = :bookingId', { bookingId })
        .andWhere('"assignment_active" = true')
        .execute();
    });

    this.detachBooking(bookingId);
  }

  async accept(id: string, dto: { waiterId: string; waiterName: string }) {
    const result = await this.dataSource.transaction(async (manager) => {
      const callRepo = manager.getRepository(WaiterCallRecord);
      const call = await callRepo.findOne({
        where: { id },
        relations: { booking: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!call) throw new NotFoundException('Виклик не знайдено');
      if (call.status === 'closed') throw new BadRequestException('Виклик вже закрито');
      if (!dto.waiterId) throw new BadRequestException('waiterId обовʼязковий');
      if (call.waiterId && call.waiterId !== dto.waiterId) {
        throw new ForbiddenException('Цей виклик призначено іншому офіціанту');
      }
      if (call.status === 'accepted') {
        return {
          message: 'Виклик вже прийнято',
          call: this.toPublicCall(call),
        };
      }

      call.status = 'accepted';
      call.waiterId = dto.waiterId;
      call.waiterName = dto.waiterName || 'Офіціант';
      call.assignmentActive = true;
      call.acceptedAt = new Date();

      const saved = await callRepo.save(call);
      return {
        message: 'Виклик прийнято',
        call: this.toPublicCall(saved),
      };
    });

    if (result.call.status === 'accepted' && result.call.waiterId) {
      this.rememberAssignment({
        bookingId: result.call.bookingId,
        tableId: result.call.tableId,
        tableNumber: result.call.tableNumber,
        waiterId: result.call.waiterId,
        waiterName: result.call.waiterName || 'Офіціант',
        assignedAt: result.call.acceptedAt || this.now(),
      });
    }

    return result;
  }

  async close(id: string, waiterId: string) {
    return this.dataSource.transaction(async (manager) => {
      const callRepo = manager.getRepository(WaiterCallRecord);
      const call = await callRepo.findOne({
        where: { id },
        relations: { booking: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!call) throw new NotFoundException('Виклик не знайдено');
      if (call.status === 'closed') throw new BadRequestException('Виклик вже закрито');
      if (call.status !== 'accepted') throw new BadRequestException('Спочатку прийміть виклик');
      if (!waiterId) throw new BadRequestException('waiterId обовʼязковий');
      if (call.waiterId !== waiterId) {
        throw new ForbiddenException('Цей виклик призначено іншому офіціанту');
      }

      call.status = 'closed';
      call.closedAt = new Date();

      const saved = await callRepo.save(call);
      return {
        message: 'Виклик закрито',
        call: this.toPublicCall(saved),
      };
    });
  }
}
