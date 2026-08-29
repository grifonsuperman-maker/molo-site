import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';

const MAX_GUEST_TABLE_NUMBER_LENGTH = 32;

@Injectable()
export class GuestTableNumberValidationService {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
  ) {}

  async resolveExisting(tableNumber: string | null | undefined) {
    const normalized = String(tableNumber || '').trim();
    if (!normalized) return null;

    if (normalized.length > MAX_GUEST_TABLE_NUMBER_LENGTH) {
      throw new BadRequestException('Стіл не знайдено. Перевірте номер столу.');
    }

    const table = await this.tables.findOne({
      where: { tableNumber: normalized },
    });

    if (!table) {
      throw new BadRequestException(
        `Стіл №${normalized} не знайдено. Перевірте номер столу.`,
      );
    }

    return String(table.tableNumber);
  }
}
