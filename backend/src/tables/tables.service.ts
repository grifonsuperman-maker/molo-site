import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TableEntity, TableStatus } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { TableMapIdentityService } from './table-map-identity.service';
import { rethrowTableNumberConflict } from './table-number-conflict';
import { SyrveStaffActionsService } from '../syrve/syrve-staff-actions.service';

const ACTIVE_BOOKING_STATUSES = ['pending', 'approved'] as const;

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly mapIdentities: TableMapIdentityService,
    private readonly staffActions: SyrveStaffActionsService,
  ) {}

  async findAll() {
    const tables = await this.tables.find({ relations: ['zone'], order: { tableNumber: 'ASC' } });
    return (await this.mapIdentities.project(tables)).tables;
  }

  getMapIdentityDiagnostics() {
    return this.mapIdentities.diagnostics();
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
        isVisible: true,
      }),
    ).catch(rethrowTableNumberConflict);
  }

  async findOrCreateByNumber(tableNumber: string) {
    if ((await this.mapIdentities.project([])).prepared) {
      // A stale number may now belong to another UUID or an intentionally empty
      // physical slot. Prepared clients must send the selected table UUID.
      throw new ConflictException('Номер столу міг змінитися. Оновіть список та оберіть стіл знову.');
    }
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
        isVisible: true,
      }),
    ).catch(rethrowTableNumberConflict);

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

    // Save only explicitly requested fields, never a stale copy of its number.
    await this.tables.save({ id: table.id,
      ...Object.fromEntries(Object.entries(dto).filter(([key]) => key !== 'zoneId')),
      ...(dto.zoneId ? { zone: table.zone } : {}),
    }).catch(rethrowTableNumberConflict);
    return this.tables.findOne({ where: { id }, relations: ['zone'] });
  }

  private async staffStatus(id: string, action: 'manual_free' | 'status_changed',
    change: (table: TableEntity, bookings: Repository<Booking>) => Promise<void>) {
    const write = async (manager: EntityManager) => {
      const tables = manager.getRepository(TableEntity);
      // Lock only the physical row; PostgreSQL cannot lock a nullable zone join.
      await tables.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      const table = await tables.findOne({ where: { id }, relations: ['zone'] });
      if (!table) throw new NotFoundException('Стіл не знайдено');
      await change(table, manager.getRepository(Booking));
      await tables.save({ id: table.id, status: table.status });
      return tables.findOne({ where: { id: table.id }, relations: ['zone'] });
    };
    return this.staffActions.run(id, action, write);
  }

  async setStatus(id: string, status: TableStatus) {
    return this.staffStatus(id, status === 'free' ? 'manual_free' : 'status_changed', async (table) => {
      table.status = status;
    });
  }

  async setStatusByNumber(tableNumber: string, status: TableStatus) {
    const table = await this.findOrCreateByNumber(tableNumber);
    if (!table) throw new NotFoundException('Стіл не знайдено');

    return this.setStatus(table.id, status);
  }

  async setWaiterStatus(id: string, status: 'occupied' | 'free') {
    if (status !== 'occupied' && status !== 'free') {
      throw new BadRequestException('Офіціант може встановити лише статус «Зайнятий» або «Вільний»');
    }

    return this.staffStatus(id, status === 'free' ? 'manual_free' : 'status_changed', async (table, bookings) => {
      if (status === 'occupied') {
        if (table.status === 'closed') {
          throw new BadRequestException('Закритий Адміністратором стіл не можна позначити зайнятим');
        }
        if (table.status === 'reserved' || table.status === 'pending') {
          throw new BadRequestException('На цей стіл уже є активне бронювання');
        }

        table.status = 'occupied';
        return;
      }

      const activeBookings = await bookings.find({
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
    });
  }

  markOccupied(id: string) {
    return this.setStatus(id, 'occupied');
  }

  markCleaning(id: string) {
    return this.setStatus(id, 'cleaning');
  }

  markFree(id: string) {
    return this.setStatus(id, 'free');
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
