import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';

type AdvisoryLock = readonly [key: string, scope: string];

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
    return this.withLocks([[tableKey, dto.bookingDate]], work);
  }

  async withTransferLock<T>(bookingId: string, tableId: string, work: () => Promise<T>) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const acquired: AdvisoryLock[] = [];

    try {
      await this.acquireLock(runner, [`booking:${bookingId}`, 'waiter-transfer'], acquired);

      const booking = await this.bookings.findOne({
        where: { id: bookingId },
        relations: ['table'],
      });
      if (!booking) return await work();

      const destinationTableKey = await this.resolveTableKey(tableId, null);
      const tableKeys = Array.from(
        new Set(
          [booking.table?.id, destinationTableKey].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ).sort();

      for (const tableKey of tableKeys) {
        await this.acquireLock(runner, [tableKey, booking.bookingDate], acquired);
      }

      return await work();
    } finally {
      try {
        await this.releaseLocks(runner, acquired);
      } finally {
        await runner.release();
      }
    }
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

  private async withLocks<T>(locks: AdvisoryLock[], work: () => Promise<T>) {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const acquired: AdvisoryLock[] = [];

    try {
      for (const lock of locks) {
        await this.acquireLock(runner, lock, acquired);
      }
      return await work();
    } finally {
      try {
        await this.releaseLocks(runner, acquired);
      } finally {
        await runner.release();
      }
    }
  }

  private async acquireLock(
    runner: QueryRunner,
    lock: AdvisoryLock,
    acquired: AdvisoryLock[],
  ) {
    await runner.query(
      'SELECT pg_advisory_lock(hashtext($1::text), hashtext($2::text))',
      [lock[0], lock[1]],
    );
    acquired.push(lock);
  }

  private async releaseLocks(runner: QueryRunner, acquired: AdvisoryLock[]) {
    for (const lock of [...acquired].reverse()) {
      await runner.query(
        'SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))',
        [lock[0], lock[1]],
      );
    }
  }
}
