import { ConflictException } from '@nestjs/common';

export function rethrowTableNumberConflict(error: unknown): never {
  const failure = error as { code?: string; constraint?: string;
    driverError?: { code?: string; constraint?: string } };
  const pg = failure?.driverError || failure;
  if (pg?.code === '23505' && pg.constraint === 'UQ_tables_canonical_number') {
    throw new ConflictException('Цей номер столу вже використовується. Оберіть інший номер.');
  }
  throw error;
}
