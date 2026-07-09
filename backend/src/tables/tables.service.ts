import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TableEntity, TableStatus } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(Zone) private readonly zones: Repository<Zone>,
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

    return this.tables.save(
      this.tables.create({
        zone,
        tableNumber: dto.tableNumber,
        seats: dto.seats,
        shape: dto.shape || 'rectangle',
        photoUrl: dto.photoUrl || null,
        x: dto.x ?? 0,
        y: dto.y ?? 0,
        width: dto.width ?? 100,
        height: dto.height ?? 80,
        rotation: dto.rotation ?? 0,
        status: 'free',
      }),
    );
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
      Object.fromEntries(Object.entries(dto).filter(([key]) => key !== 'zoneId')),
    );

    return this.tables.save(table);
  }

  async setStatus(id: string, status: TableStatus) {
    const table = await this.tables.findOne({ where: { id }, relations: ['zone'] });
    if (!table) throw new NotFoundException('Стіл не знайдено');

    table.status = status;
    return this.tables.save(table);
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
}
