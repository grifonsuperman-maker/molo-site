import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, LessThanOrEqual, Repository } from "typeorm";
import { Booking } from "../bookings/entities/booking.entity";
import { Restaurant } from "../restaurant/entities/restaurant.entity";
import { Staff } from "../staff/entities/staff.entity";
import { WaiterCallsService } from "../waiter-calls/waiter-calls.service";
import { AcceptHookahCallDto } from "./dto/accept-hookah-call.dto";
import { CancelHookahCallDto } from "./dto/cancel-hookah-call.dto";
import { CreateHookahCallDto } from "./dto/create-hookah-call.dto";
import { HookahCall, HookahCallStatus } from "./entities/hookah-call.entity";

const ACTIVE_STATUSES: HookahCallStatus[] = ["new", "accepted"];

@Injectable()
export class HookahCallsService {
  constructor(
    @InjectRepository(HookahCall)
    private readonly hookahCallsRepo: Repository<HookahCall>,

    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,

    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,

    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,

    private readonly waiterCalls: WaiterCallsService,

    private readonly dataSource: DataSource,
  ) {}

  private kyivDate(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }

  private async getRestaurant(
    repository: Repository<Restaurant> = this.restaurantRepo,
  ) {
    const [restaurant] = await repository.find({
      order: { createdAt: "ASC" },
      take: 1,
    });
    return restaurant || null;
  }

  async availability() {
    const restaurant = await this.getRestaurant();
    return {
      available: restaurant?.hookahCallsAvailable !== false,
      changedAt: restaurant?.hookahCallsAvailabilityChangedAt || null,
    };
  }

  async setAvailability(staffId: string, available: boolean) {
    const worker = await this.staffRepo.findOne({
      where: {
        id: staffId,
        role: "hookah",
        active: true,
        isArchived: false,
        isOnShift: true,
      },
    });
    if (!worker) {
      throw new BadRequestException(
        "Змінити доступність може лише кальянник на зміні",
      );
    }

    const restaurant = await this.getRestaurant();
    if (!restaurant) throw new NotFoundException("Ресторан не знайдено");
    restaurant.hookahCallsAvailable = available;
    restaurant.hookahCallsAvailabilityChangedAt = new Date();
    await this.restaurantRepo.save(restaurant);

    return {
      message: available
        ? "Виклики кальянника знову доступні гостям"
        : "Нові виклики тимчасово заблоковано",
      available,
      changedAt: restaurant.hookahCallsAvailabilityChangedAt,
    };
  }

  private async expireOverdueCalls(
    repository: Repository<HookahCall> = this.hookahCallsRepo,
    bookingId?: string,
  ) {
    const where: any = {
      status: "accepted",
      etaDueAt: LessThanOrEqual(new Date()),
    };
    if (bookingId) where.booking = { id: bookingId };
    const overdue = await repository.find({
      where,
      relations: { booking: true },
    });
    if (!overdue.length) return;
    const completedAt = new Date();
    overdue.forEach((call) => {
      call.status = "completed";
      call.completedAt = completedAt;
    });
    await repository.save(overdue);
  }

  async guestStatus(bookingId: string) {
    const booking = await this.getBookingOrThrow(bookingId);

    await this.expireOverdueCalls(this.hookahCallsRepo, booking.id);
    const availability = await this.availability();

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
        createdAt: "DESC",
      },
    });

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      tableStatus: booking.table?.status || null,
      tableNumber: booking.table?.tableNumber || null,
      zoneName: booking.table?.zone?.name || null,
      canCall:
        booking.status === "approved" &&
        booking.bookingDate === this.kyivDate() &&
        booking.table?.status === "occupied" &&
        availability.available &&
        !activeCall,
      hookahCallsAvailable: availability.available,
      activeCall: activeCall ? this.toPublicCall(activeCall) : null,
    };
  }

  async createFromGuest(dto: CreateHookahCallDto) {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const callRepo = manager.getRepository(HookahCall);
      const staffRepo = manager.getRepository(Staff);
      const restaurantRepo = manager.getRepository(Restaurant);

      await this.expireOverdueCalls(callRepo, dto.bookingId);

      const lockedBooking = await bookingRepo
        .createQueryBuilder("booking")
        .where("booking.id = :bookingId", { bookingId: dto.bookingId })
        .setLock("pessimistic_write", undefined, ["booking"])
        .getOne();

      if (!lockedBooking) {
        throw new NotFoundException("Бронювання не знайдено");
      }

      const booking = await bookingRepo.findOne({
        where: {
          id: dto.bookingId,
        },
        relations: {
          table: {
            zone: true,
          },
          client: true,
        },
      });

      if (!booking) {
        throw new NotFoundException("Бронювання не знайдено");
      }

      if (booking.bookingDate !== this.kyivDate()) {
        throw new BadRequestException(
          "Виклик кальянника доступний тільки у день візиту",
        );
      }

      if (
        booking.status !== "approved" ||
        booking.table?.status !== "occupied"
      ) {
        throw new BadRequestException(
          "Виклик кальянника доступний тільки після приходу гостя за стіл",
        );
      }

      const restaurant = await this.getRestaurant(restaurantRepo);
      if (restaurant?.hookahCallsAvailable === false) {
        throw new BadRequestException(
          "Зараз немає вільних кальянів. Спробуйте трохи пізніше",
        );
      }

      const activeHookahWorkers = await staffRepo.count({
        where: {
          role: "hookah",
          active: true,
          isArchived: false,
          isOnShift: true,
        },
      });

      if (activeHookahWorkers === 0) {
        throw new BadRequestException("Зараз немає кальянників на зміні");
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
          createdAt: "DESC",
        },
      });

      if (existing) {
        return {
          message: "Виклик уже відправлено",
          call: this.toPublicCall(existing),
        };
      }

      const call = callRepo.create({
        booking,
        table: booking.table,
        acceptedByStaff: null,
        status: "new",
        etaMinutes: null,
        etaDueAt: null,
        waiterName:
          (await this.waiterCalls.assignmentForBooking(booking))?.waiterName ||
          null,
        acceptedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelReason: null,
      });

      const saved = await callRepo.save(call);
      const hydrated = await this.getCallOrThrow(saved.id, callRepo);

      return {
        message: "Виклик кальянника відправлено",
        call: this.toPublicCall(hydrated),
      };
    });
  }

  async listActive() {
    await this.expireOverdueCalls();
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
        createdAt: "ASC",
      },
    });

    return calls.map((call) => this.toPublicCall(call));
  }

  async listMine(staffId: string) {
    await this.expireOverdueCalls();
    const calls = await this.hookahCallsRepo.find({
      where: {
        acceptedByStaff: {
          id: staffId,
        },
        status: "accepted",
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
        acceptedAt: "ASC",
      },
    });

    return calls.map((call) => this.toPublicCall(call));
  }

  async accept(callId: string, staffId: string, dto: AcceptHookahCallDto) {
    return this.dataSource.transaction(async (manager) => {
      const callRepo = manager.getRepository(HookahCall);
      const staffRepo = manager.getRepository(Staff);

      const worker = await staffRepo.findOne({
        where: {
          id: staffId,
          role: "hookah",
          active: true,
          isArchived: false,
          isOnShift: true,
        },
      });

      if (!worker) {
        throw new BadRequestException(
          "Прийняти виклик може лише активний кальянник на зміні",
        );
      }

      const call = await callRepo.findOne({
        where: {
          id: callId,
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
      });

      if (!call) {
        throw new NotFoundException("Виклик не знайдено");
      }

      if (call.status !== "new") {
        throw new BadRequestException(
          call.status === "accepted"
            ? "Цей виклик уже прийняв інший кальянник"
            : "Цей виклик уже закрито",
        );
      }

      call.status = "accepted";
      call.acceptedByStaff = worker;
      call.etaMinutes = dto.etaMinutes;
      call.acceptedAt = new Date();
      call.etaDueAt = new Date(
        call.acceptedAt.getTime() + dto.etaMinutes * 60_000,
      );

      const saved = await callRepo.save(call);
      const hydrated = await this.getCallOrThrow(saved.id, callRepo);

      return {
        message: "Виклик прийнято",
        call: this.toPublicCall(hydrated),
      };
    });
  }

  async complete(callId: string, staffId: string) {
    const call = await this.getCallOrThrow(callId);

    if (call.status !== "accepted") {
      throw new BadRequestException("Завершити можна лише прийнятий виклик");
    }

    if (call.acceptedByStaff?.id !== staffId) {
      throw new BadRequestException(
        "Завершити виклик може лише кальянник, який його прийняв",
      );
    }

    call.status = "completed";
    call.completedAt = new Date();

    const saved = await this.hookahCallsRepo.save(call);
    return {
      message: "Виклик виконано",
      call: this.toPublicCall(saved),
    };
  }

  async cancel(callId: string, dto: CancelHookahCallDto) {
    const call = await this.getCallOrThrow(callId);

    if (!ACTIVE_STATUSES.includes(call.status)) {
      throw new BadRequestException("Цей виклик уже закрито");
    }

    call.status = "cancelled";
    call.cancelledAt = new Date();
    call.cancelReason = dto.reason.trim();

    const saved = await this.hookahCallsRepo.save(call);
    return {
      message: "Виклик скасовано",
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
      throw new NotFoundException("Бронювання не знайдено");
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
      throw new NotFoundException("Виклик не знайдено");
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
      etaDueAt: call.etaDueAt,
      waiterName: call.waiterName,
      createdAt: call.createdAt,
      acceptedAt: call.acceptedAt,
      completedAt: call.completedAt,
      cancelledAt: call.cancelledAt,
      cancelReason: call.cancelReason,
    };
  }
}
