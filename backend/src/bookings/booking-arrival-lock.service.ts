import { Injectable } from '@nestjs/common';

@Injectable()
export class BookingArrivalLockService {
  /**
   * Compatibility boundary for existing web/scheduler call sites.
   * The real cross-instance serialization now happens inside the same
   * database transaction as each booking state transition via
   * `pessimistic_write`, so this wrapper must not reserve a second pooled
   * connection while the protected work asks TypeORM for another one.
   */
  async withLock<T>(_bookingId: string, work: () => Promise<T>) {
    return work();
  }

  async withCheckInLock<T>(_bookingId: string, work: () => Promise<T>) {
    return work();
  }
}
