import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { BookingTableAssignment } from './entities/booking-table-assignment.entity';
import { Booking } from './entities/booking.entity';

export async function bookingTableAssignmentsReady(manager: EntityManager) {
  if (typeof manager?.query !== 'function') return false;
  const rows = await manager.query(
    `SELECT to_regclass('public.booking_table_assignments') IS NOT NULL AS "ready"`,
  );
  return Array.isArray(rows) && rows[0]?.ready === true;
}

export async function syncSingleTableTransferAssignment(
  manager: EntityManager,
  booking: Booking,
  nextTable: TableEntity,
  knownAssignmentsReady?: boolean,
) {
  const assignmentsReady =
    knownAssignmentsReady ?? await bookingTableAssignmentsReady(manager);
  if (!assignmentsReady) return;

  const repository = manager.getRepository(BookingTableAssignment);
  const assignments = await repository
    .createQueryBuilder('assignment')
    .innerJoinAndSelect('assignment.table', 'assignedTable')
    .where('"assignment"."booking_id" = :bookingId', { bookingId: booking.id })
    .setLock('pessimistic_write', undefined, ['assignment'])
    .getMany();

  if (assignments.length > 1) {
    throw new BadRequestException(
      'Банкетне бронювання не можна переносити цим способом',
    );
  }

  if (assignments.length === 1) {
    const [assignment] = assignments;
    if (!assignment.isPrimary) {
      throw new BadRequestException(
        'Не вдалося перевірити основний стіл бронювання',
      );
    }

    assignment.table = nextTable;
    await repository.save(assignment);
    return;
  }

  await repository.save(
    repository.create({
      booking,
      table: nextTable,
      isPrimary: true,
    }),
  );
}
