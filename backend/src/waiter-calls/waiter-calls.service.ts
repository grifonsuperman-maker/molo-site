import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';

type WaiterCallStatus = 'new' | 'accepted' | 'closed';

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

@Injectable()
export class WaiterCallsService {
  private calls: WaiterCall[] = [];
  private assignments: WaiterAssignment[] = [];

  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
  ) {}

  private now() {
    return new Date().toISOString();
  }

  private makeId() {
    return `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  private async getBooking(bookingId: string) {
    const booking = await this.bookings.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });

    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    return booking;
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

    const assignment: WaiterAssignment = {
      bookingId: booking.id,
      tableId: dto.tableId || booking.table?.id || null,
      tableNumber: dto.tableNumber || booking.table?.tableNumber || null,
      waiterId: dto.waiterId,
      waiterName: dto.waiterName || 'Офіціант',
      assignedAt: this.now(),
    };

    this.assignments = this.assignments.filter(
      (item) =>
        item.bookingId !== assignment.bookingId &&
        (!assignment.tableId || item.tableId !== assignment.tableId) &&
        (!assignment.tableNumber || item.tableNumber !== assignment.tableNumber),
    );

    this.assignments.push(assignment);

    return {
      message: 'Офіціанта закріплено за столом',
      assignment,
    };
  }

  async guestStatus(bookingId: string) {
    const booking = await this.getBooking(bookingId);
    const tableStatus = booking.table?.status || null;
    const canCall = booking.status === 'approved' && tableStatus === 'occupied';

    const activeCall =
      this.calls.find(
        (call) =>
          call.bookingId === booking.id &&
          call.status !== 'closed',
      ) || null;

    const assignment = this.findAssignment(booking);

    return {
      bookingId: booking.id,
      tableNumber: booking.table?.tableNumber || null,
      bookingStatus: booking.status,
      tableStatus,
      canCall,
      waiterAssigned: Boolean(assignment),
      waiterName: assignment?.waiterName || null,
      activeCall,
    };
  }

  async createFromGuest(dto: { bookingId: string }) {
    if (!dto.bookingId) throw new BadRequestException('bookingId обовʼязковий');

    const booking = await this.getBooking(dto.bookingId);
    const status = await this.guestStatus(booking.id);

    if (!status.canCall) {
      throw new BadRequestException('Виклик офіціанта доступний тільки після приходу гостя за стіл');
    }

    const existing = this.calls.find(
      (call) => call.bookingId === booking.id && call.status !== 'closed',
    );

    if (existing) {
      return {
        message: 'Виклик вже відправлено',
        call: existing,
      };
    }

    const assignment = this.findAssignment(booking);

    const call: WaiterCall = {
      id: this.makeId(),
      bookingId: booking.id,
      tableId: booking.table?.id || null,
      tableNumber: booking.table?.tableNumber || null,
      clientName: booking.client?.fullName || null,
      waiterId: assignment?.waiterId || null,
      waiterName: assignment?.waiterName || null,
      status: 'new',
      createdAt: this.now(),
      acceptedAt: null,
      closedAt: null,
    };

    this.calls.unshift(call);

    return {
      message: assignment
        ? `Виклик відправлено офіціанту ${assignment.waiterName}`
        : 'Виклик відправлено у загальний список офіціантів',
      call,
    };
  }

  list(waiterId?: string) {
    const active = this.calls.filter((call) => call.status !== 'closed');

    if (!waiterId) return active;

    return active.filter((call) => !call.waiterId || call.waiterId === waiterId);
  }

  myAssignments(waiterId: string) {
    if (!waiterId) return [];
    return [...this.assignments]
      .filter((assignment) => assignment.waiterId === waiterId)
      .reverse()
      .slice(0, 50);
  }

  detachBooking(bookingId: string) {
    this.assignments = this.assignments.filter((assignment) => assignment.bookingId !== bookingId);
  }

  /** Invalidates active guest calls after the booking has been moved to another table. */
  closeActiveCallsAndDetachBooking(bookingId: string) {
    const closedAt = this.now();

    for (const call of this.calls) {
      if (call.bookingId === bookingId && (call.status === 'new' || call.status === 'accepted')) {
        call.status = 'closed';
        call.closedAt = closedAt;
      }
    }

    this.detachBooking(bookingId);
  }

  accept(id: string, dto: { waiterId: string; waiterName: string }) {
    const call = this.calls.find((item) => item.id === id);
    if (!call) throw new NotFoundException('Виклик не знайдено');
    if (call.status === 'closed') throw new BadRequestException('Виклик вже закрито');
    if (!dto.waiterId) throw new BadRequestException('waiterId обовʼязковий');

    call.status = 'accepted';
    call.waiterId = dto.waiterId;
    call.waiterName = dto.waiterName || 'Офіціант';
    call.acceptedAt = this.now();

    this.assignments = this.assignments.filter(
      (item) =>
        item.bookingId !== call.bookingId &&
        (!call.tableId || item.tableId !== call.tableId) &&
        (!call.tableNumber || item.tableNumber !== call.tableNumber),
    );

    this.assignments.push({
      bookingId: call.bookingId,
      tableId: call.tableId,
      tableNumber: call.tableNumber,
      waiterId: call.waiterId,
      waiterName: call.waiterName,
      assignedAt: call.acceptedAt,
    });

    return {
      message: 'Виклик прийнято',
      call,
    };
  }

  close(id: string) {
    const call = this.calls.find((item) => item.id === id);
    if (!call) throw new NotFoundException('Виклик не знайдено');

    call.status = 'closed';
    call.closedAt = this.now();

    return {
      message: 'Виклик закрито',
      call,
    };
  }
}
