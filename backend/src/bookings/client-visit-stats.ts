import { EntityManager } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { Booking } from './entities/booking.entity';

// This helper runs inside a transaction; the client row lock serializes derived visit counters.
export async function refreshClientVisitStats(
  manager: EntityManager,
  clientId: string,
) {
  const clients = manager.getRepository(Client);
  const client = await clients.findOne({
    where: { id: clientId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!client) return;

  const completedBookings = await manager
    .getRepository(Booking)
    .createQueryBuilder('booking')
    .leftJoin('booking.client', 'client')
    .where('client.id = :clientId', { clientId })
    .andWhere('booking.status = :status', { status: 'completed' })
    .getMany();

  client.visitsCount = completedBookings.length;
  client.totalGuests = completedBookings.reduce(
    (sum, item) => sum + Number(item.guestsCount || 0),
    0,
  );
  client.lastVisitAt = completedBookings.reduce<Date | null>((latest, item) => {
    if (!item.completedAt) return latest;
    if (!latest || item.completedAt.getTime() > latest.getTime()) {
      return item.completedAt;
    }
    return latest;
  }, null);

  await clients.save(client);
}
