import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Booking } from '../bookings/entities/booking.entity';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TableEntity, TableStatus } from './entities/table.entity';
import { TableOwnershipService } from './table-ownership.service';
import { Zone } from '../zones/entities/zone.entity';

const ACTIVE_BOOKING_STATUSES = ['pending', 'approved'] as const;

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly ownership: TableOwnershipService,
  ) {}

  findAll() {
    return this.tables.find({ relations: ['zone'], order: { tableNumber: 'ASC' } });
  }

  async create(dto: CreateTableDto) {
    let zone: Zone | null = null;

    if (dto.zoneId) {
      zone = await this.zones.findOne({ where: { id: dto.zoneId } });
      if (!zone) throw new NotFoundException('Зону не знайдено');
    }

    const existing = await this.tables.findOne({ where: { tableNumber: String(dto.tableNumber) }, relations: ['zone'] });
    if (existing) return existing;

    return this.tables.save(
      this.tables.create({
        zone,
        tableNumber: String(dto.tableNumber),
        seats: dto.seats,
        shape: dto.shape || 'rectangle',
        photoUrl: dto.photoUrl || null,
        x: dto.x ?? 0,
        y: dto.y ?? 0,
        width: dto.width ?? 100,
        height: dto.height ?? 80,
        rotation: dto.rotation ?? 0,
        status: 'free',
        assignedWaiterId: null,
        isVisible: true,
      }),
    );
  }

  async findOrCreateByNumber(tableNumber: string) {
    const normalized = String(tableNumber || '').trim();
    let table = await this.tables.findOne({ where: { tableNumber: normalized }, relations: ['zone'] });

    if (table) return table;

    table = await this.tables.save(
      this.tables.create({
        tableNumber: normalized,
        seats: 4,
        shape: 'rectangle',
        photoUrl: null,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        status: 'free',
        assignedWaiterId: null,
        isVisible: true,
      }),
    );

    return this.tables.findOne({ where: { id: table.id }, relations: ['zone'] });
  }

  async update(id: string, dto: UpdateTableDto) {
    const table = await this.tables.findOne({ where: { id }, relations: ['zone'] });
    if (!table) throw new NotFoundException('Стіл не знайдено');

    if (dto.zoneId) {
      const zone = await this.zones.findOne({ where: { id: dto.zoneId } });
      if (!zone) throw new NotFoundException('Зону не знайдено');
      table.zone = zone;
    }

    Object.assign(
      table,
      Object.fromEntries(Object.entries(dto).filter(([key]) => key !== 'zoneId' && key !== 'assignedWaiterId')),
    );
    if (table.status === 'free') table.assignedWaiterId = null;

    return this.tables.save(table);
  }

  async setStatus(id: string, status: TableStatus, actor?: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!table) throw new NotFoundException('Стіл не знайдено');

      this.ownership.assertCanModify(table, actor);
      if (actor?.role === 'waiter' && status === 'occupied') {
        if (table.status === 'closed') {
          throw new BadRequestException('Закритий Адміністратором стіл не можна позначити зайнятим');
        }
        this.ownership.claim(table, actor);
      }
      table.status = status;
      if (status === 'free') table.assignedWaiterId = null;
      await tables.save(table);
      return tables.findOne({ where: { id }, relations: ['zone'] });
    });
  }

  async setStatusByNumber(tableNumber: string, status: TableStatus) {
    const table = await this.findOrCreateByNumber(tableNumber);
    if (!table) throw new NotFoundException('Стіл не знайдено');
    return this.setStatus(table.id, status);
  }

  async setWaiterStatus(id: string, status: 'occupied' | 'free', actor?: AuthUser) {
    if (status !== 'occupied' && status !== 'free') {
      throw new BadRequestException('Офіціант може встановити лише статус «Зайнятий» або «Вільний»');
    }
    if (!actor || !['waiter', 'admin', 'owner'].includes(actor.role)) {
      throw new ForbiddenException('Не вдалося визначити права працівника');
    }

    return this.dataSource.transaction(async (manager) => {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!table) throw new NotFoundException('Стіл не знайдено');
      this.ownership.assertCanModify(table, actor);

      if (status === 'occupied') {
        if (table.status === 'closed') {
          throw new BadRequestException('Закритий Адміністратором стіл не можна позначити зайнятим');
        }
        if (table.status === 'reserved' || table.status === 'pending') {
          throw new BadRequestException('На цей стіл уже є активне бронювання');
        }
        this.ownership.claim(table, actor);
        table.status = 'occupied';
        await tables.save(table);
        return tables.findOne({ where: { id }, relations: ['zone'] });
      }

      const activeBookings = await manager.getRepository(Booking).find({
        where: {
          table: { id: table.id },
          bookingDate: this.kyivToday(),
          status: In([...ACTIVE_BOOKING_STATUSES]),
        } as any,
        relations: ['table'],
      });

      if (activeBookings.some((booking) => booking.status === 'approved' && booking.checkedInAt)) {
        table.status = 'occupied';
      } else if (activeBookings.some((booking) => booking.status === 'approved')) {
        table.status = 'reserved';
      } else if (activeBookings.some((booking) => booking.status === 'pending')) {
        table.status = 'pending';
      } else {
        table.status = 'free';
      }
      if (table.status !== 'occupied') table.assignedWaiterId = null;
      await tables.save(table);
      return tables.findOne({ where: { id }, relations: ['zone'] });
    });
  }

  markOccupied(id: string, actor?: AuthUser) {
    return this.setStatus(id, 'occupied', actor);
  }

  markCleaning(id: string, actor?: AuthUser) {
    return this.setStatus(id, 'cleaning', actor);
  }

  markFree(id: string, actor?: AuthUser) {
    return this.setStatus(id, 'free', actor);
  }

  close(id: string) {
    return this.setStatus(id, 'closed');
  }

  open(id: string) {
    return this.setStatus(id, 'free');
  }

  async remove(id: string) {
    const table = await this.tables.findOne({ where: { id } });
    if (!table) throw new NotFoundException('Стіл не знайдено');

    await this.tables.remove(table);
    return { message: 'Стіл видалено' };
  }

  private kyivToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
