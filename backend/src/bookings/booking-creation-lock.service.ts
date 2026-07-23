import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';

export type BookingCreationLockInput = {
  tableId?: string | null;
  tableNumber?: string | number | null;
  bookingDate: string;
};

@Injectable()
export class BookingCreationLockService {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(input: BookingCreationLockInput, action: () => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    const tableKey = await this.resolveTableKey(queryRunner, input);
    const bookingDate = String(input.bookingDate || '').trim();

    await queryRunner.query(
      'SELECT pg_advisory_lock(hashtext($1), hashtext($2))',
      [tableKey, bookingDate],
    );

    try {
      return await action();
    } finally {
      try {
        await queryRunner.query(
          'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
          [tableKey, bookingDate],
        );
      } finally {
        await queryRunner.release();
      }
    }
  }

  private async resolveTableKey(queryRunner: QueryRunner, input: BookingCreationLockInput) {
    const tableId = String(input.tableId || '').trim();
    const tableNumber = String(input.tableNumber || '').trim();
    const repository = queryRunner.manager.getRepository(TableEntity);

    let query = repository
      .createQueryBuilder('table')
      .select('table.id', 'id');

    if (tableId && !tableId.startsWith('visual-')) {
      query = query.where('table.id = :tableId', { tableId });
    } else if (tableNumber) {
      query = query.where('table.tableNumber = :tableNumber', { tableNumber });
    } else {
      return `unresolved:${tableId || tableNumber || 'unknown'}`;
    }

    const table = await query.getRawOne<{ id?: string }>();
    if (table?.id) return `table:${table.id}`;

    return `number:${tableNumber || tableId}`;
  }
}
