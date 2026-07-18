import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Staff } from '../staff/entities/staff.entity';
import { AcceptHookahCallDto } from './dto/accept-hookah-call.dto';
import { CancelHookahCallDto } from './dto/cancel-hookah-call.dto';
import { CreateHookahCallDto } from './dto/create-hookah-call.dto';
import {
  HookahCall,
  HookahCallStatus,
} from './entities/hookah-call.entity';

const ACTIVE_STATUSES: HookahCallStatus[] = ['new', 'accepted'];

@Injectable()
export class HookahCallsService {
  constructor(
    @InjectRepository(HookahCall)
    private readonly hookahCallsRepo: Repository<HookahCall>,

    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,

    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,

    private readonly dataSource: DataSource,
  ) {}

  async guestStatus(bookingId: string) {
    const booking = await this.getBookingOrThrow(bookingId);

    const activeCall = await this.hookahCallsRepo.findOne({
      where: {
        booking: {
          id: booking.id,
        },
        status: In(ACTIVE_STATUSES),
      },
      relations: {
        booking: true,
        table: {
          zone: true,
        },
        acceptedByStaff: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      tableStatus: booking.table?.status || null,
      tableNumber: booking.table?.tableNumber || null,
      zoneName: booking.table?.zone?.name || null,
      canCall:
        booking.status === 'approved' &&
        booking.table?.status === 'occupied' &&
        !activeCall,
      activeCall: activeCall ? this.toPublicCall(activeCall) : null,
    };
  }

  async createFromGuest(dto: CreateHookahCallDto) {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const callRepo = manager.getRepository(HookahCall);
      const staffRepo = manager.getRepository(Staff);

      const booking = await bookingRepo
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.table', 'table')
        .leftJoinAndSelect('table.zone', 'zone')
        .leftJoinAndSelect('booking.client', 'client')
        .where('booking.id = :bookingId', {
          bookingId: dto.bookingId,
        })
        .setLock('pessimistic_write')
        .getOne();

      if (!booking) {
        throw new NotFoundException('Бронювання не знайдено');
      }

      if (
        booking.status !== 'approved' ||
        booking.table?.status !== 'occupied'
      ) {
        throw new BadRequestException(
          'Виклик кальянника доступний тільки після приходу гостя за стіл',
        );
      }

      const activeHookahWorkers = await staffRepo.count({
        where: {
          role: 'hookah',
          active: true,
          isArchived: false,
          isOnShift: true,
        },
      });

      if (activeHookahWorkers === 0) {
        throw new BadRequestException(
          'Зараз немає кальянників на зміні',
        );
      }

      const existing = await callRepo.findOne({
        where: {
          booking: {
            id: booking.id,
          },
          status: In(ACTIVE_STATUSES),
        },
        relations: {
          booking: true,
          table: {
            zone: true,
          },
          acceptedByStaff: true,
        },
        order: {
          createdAt: 'DESC',
        },
      });

      if (existing) {
        return {
          message: 'Виклик уже відправлено',
          call: this.toPublicCall(existing),
        };
      }

      const call = callRepo.create({
        booking,
        table: booking.table,
        acceptedByStaff: null,
        status: 'new',
        etaMinutes: null,
        acceptedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelReason: null,
      });

      const saved = await callRepo.save(call);
      const hydrated = await this.getCallOrThrow(saved.id, callRepo);

      return {
        message: 'Виклик кальянника відправлено',
        call: this.toPublicCall(hydrated),
      };
    });
  }

  async listActive() {
    const calls = await this.hookahCallsRepo.find({
      where: {
        status: In(ACTIVE_STATUSES),
      },
      relations: {
        booking: {
          client: true,
        },
        table: {
          zone: true,
        },
        acceptedByStaff: true,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return calls.map((call) => this.toPublicCall(call));
  }

  async listMine(staffId: string) {
    const calls = await this.hookahCallsRepo.find({
      where: {
        acceptedByStaff: {
          id: staffId,
        },
        status: 'accepted',
      },
      relations: {
        booking: {
          client: true,
        },
        table: {
          zone: true,
        },
        acceptedByStaff: true,
      },
      order: {
        acceptedAt: 'ASC',
      },
    });

    return calls.map((call) => this.toPublicCall(call));
  }

  async accept(
    callId: string,
    staffId: string,
    dto: AcceptHookahCallDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const callRepo = manager.getRepository(HookahCall);
      const staffRepo = manager.getRepository(Staff);

      const worker = await staffRepo.findOne({
        where: {
          id: staffId,
          role: 'hookah',
          active: true,
          isArchived: false,
          isOnShift: true,
        },
      });

      if (!worker) {
        throw new BadRequestException(
          'Прийняти виклик може лише активний кальянник на зміні',
        );
      }

      const call = await callRepo
        .createQueryBuilder('call')
        .leftJoinAndSelect('call.booking', 'booking')
        .leftJoinAndSelect('booking.client', 'client')
        .leftJoinAndSelect('call.table', 'table')
        .leftJoinAndSelect('table.zone', 'zone')
        .leftJoinAndSelect('call.acceptedByStaff', 'acceptedByStaff')
        .where('call.id = :callId', { callId })
        .setLock('pessimistic_write')
        .getOne();

      if (!call) {
        throw new NotFoundException('Виклик не знайдено');
      }

      if (call.status !== 'new') {
        throw new BadRequestException(
          call.status === 'accepted'
            ? 'Цей виклик уже прийняв інший кальянник'
            : 'Цей виклик уже закрито',
        );
      }

      call.status = 'accepted';
      call.acceptedByStaff = worker;
      call.etaMinutes = dto.etaMinutes;
      call.acceptedAt = new Date();

      const saved = await callRepo.save(call);
      const hydrated = await this.getCallOrThrow(saved.id, callRepo);

      return {
        message: 'Виклик прийнято',
        call: this.toPublicCall(hydrated),
      };
    });
  }

  async complete(callId: string, staffId: string) {
    const call = await this.getCallOrThrow(callId);

    if (call.status !== 'accepted') {
      throw new BadRequestException(
        'Завершити можна лише прийнятий виклик',
      );
    }

    if (call.acceptedByStaff?.id !== staffId) {
      throw new BadRequestException(
        'Завершити виклик може лише кальянник, який його прийняв',
      );
    }

    call.status = 'completed';
    call.completedAt = new Date();

    const saved = await this.hookahCallsRepo.save(call);
    return {
      message: 'Виклик виконано',
      call: this.toPublicCall(saved),
    };
  }

  async cancel(callId: string, dto: CancelHookahCallDto) {
    const call = await this.getCallOrThrow(callId);

    if (!ACTIVE_STATUSES.includes(call.status)) {
      throw new BadRequestException('Цей виклик уже закрито');
    }

    call.status = 'cancelled';
    call.cancelledAt = new Date();
    call.cancelReason = dto.reason.trim();

    const saved = await this.hookahCallsRepo.save(call);
    return {
      message: 'Виклик скасовано',
      call: this.toPublicCall(saved),
    };
  }

  private async getBookingOrThrow(id: string) {
    const booking = await this.bookingsRepo.findOne({
      where: { id },
      relations: {
        table: {
          zone: true,
        },
        client: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Бронювання не знайдено');
    }

    return booking;
  }

  private async getCallOrThrow(
    id: string,
    repository: Repository<HookahCall> = this.hookahCallsRepo,
  ) {
    const call = await repository.findOne({
      where: { id },
      relations: {
        booking: {
          client: true,
        },
        table: {
          zone: true,
        },
        acceptedByStaff: true,
      },
    });

    if (!call) {
      throw new NotFoundException('Виклик не знайдено');
    }

    return call;
  }

  private toPublicCall(call: HookahCall) {
    return {
      id: call.id,
      bookingId: call.booking?.id || null,
      tableId: call.table?.id || null,
      tableNumber: call.table?.tableNumber || null,
      zoneName: call.table?.zone?.name || null,
      clientName: call.booking?.client?.fullName || null,
      status: call.status,
      acceptedByStaffId: call.acceptedByStaff?.id || null,
      acceptedByStaffName: call.acceptedByStaff?.fullName || null,
      etaMinutes: call.etaMinutes,
      createdAt: call.createdAt,
      acceptedAt: call.acceptedAt,
      completedAt: call.completedAt,
      cancelledAt: call.cancelledAt,
      cancelReason: call.cancelReason,
    };
  }
}
