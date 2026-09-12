import type { AuthUser } from '../auth/types/auth-user.type';
import { BookingArrivalLockService } from './booking-arrival-lock.service';
import { BookingsService } from './bookings.service';

export const RAW_BOOKINGS_SERVICE = Symbol('RAW_BOOKINGS_SERVICE');

export function createCoordinatedBookingsService(
  rawBookings: BookingsService,
  arrivalLock: BookingArrivalLockService,
): BookingsService {
  return new Proxy(rawBookings, {
    get(target, property, receiver) {
      if (property === 'checkIn') {
        return (bookingId: string, actor?: AuthUser) =>
          arrivalLock.withCheckInLock(bookingId, () =>
            target.checkIn(bookingId, actor),
          );
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
