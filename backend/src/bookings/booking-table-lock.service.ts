import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingTableLockService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
  ) {}

  async withCreateLock<T>(dto: CreateBookingDto, work: () => Promise<T>) {
    const tableKey = await this.resolveTableKey(dto.tableId, dto.tableNumber);
    return this.withLock(tableKey, dto.bookingDate, work);
  }

  async withTransferLock<T>(bookingId: string, tableId: string, work: () => Promise<T>) {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) return work();

    const tableKey = await this.resolveTableKey(tableId, null);
    return this.withLock(tableKey, booking.bookingDate, work);
  }

  private async resolveTableKey(tableId?: string | null, tableNumber?: string | null) {
    const normalizedId = String(tableId || '').trim();
    const normalizedNumber = String(tableNumber || '').trim();
    let table: TableEntity | null = null;

    if (normalizedId && !normalizedId.startsWith('visual-')) {
      table = await this.tables.findOne({ where: { id: normalizedId } });
    }

    if (!table && normalizedNumber) {
      table = await this.tables.findOne({ where: { tableNumber: normalizedNumber } });
    }

    if (table) return table.id;
    if (normalizedNumber) return `table-number:${normalizedNumber}`;
    if (normalizedId) return `table-id:${normalizedId}`;

    throw new BadRequestException('Оберіть стіл');
  }

  private async withLock<T>(tableKey: string, bookingDate: string, work: () => Promise<T>) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let locked = false;

    try {
      await runner.query(
        'SELECT pg_advisory_lock(hashtext($1::text), hashtext($2::text))',
        [tableKey, bookingDate],
      );
      locked = true;
      return await work();
    } finally {
      try {
        if (locked) {
          await runner.query(
            'SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))',
            [tableKey, bookingDate],
          );
        }
      } finally {
        await runner.release();
      }
    }
  }
}
