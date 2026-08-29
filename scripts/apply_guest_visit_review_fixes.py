from pathlib import Path

bookings_path = Path("backend/src/bookings/bookings.service.ts")
bookings = bookings_path.read_text()

import_anchor = "import type { AuthUser } from '../auth/types/auth-user.type';\n"
import_line = "import { refreshClientVisitStats } from './client-visit-stats';\n"
if import_line not in bookings:
    if bookings.count(import_anchor) != 1:
        raise SystemExit("BookingsService import anchor mismatch")
    bookings = bookings.replace(import_anchor, import_anchor + import_line, 1)

old_stats = """  private async refreshClientVisitStats(clientId: string) {
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) return;

    const completedBookings = await this.bookings
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
      if (!latest || item.completedAt.getTime() > latest.getTime()) return item.completedAt;
      return latest;
    }, null);

    await this.clients.save(client);
  }

"""
if bookings.count(old_stats) != 1:
    raise SystemExit("BookingsService stats helper anchor mismatch")
bookings = bookings.replace(old_stats, "", 1)

old_complete = """  async complete(id: string, actor?: AuthUser) {
    const booking = await this.bookings.findOne({ where: { id }, relations: ['table', 'client'] });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = this.bookingSnapshot(booking);
    booking.status = 'completed';
    booking.completedAt = new Date();
    await this.bookings.save(booking);
    if (booking.client?.id) {
      await this.refreshClientVisitStats(booking.client.id);
    }
    await this.saveHistory(
      booking,
      'booking_completed',
      actor?.role || 'admin',
      previousData,
      this.bookingSnapshot(booking),
      null,
      actor || null,
    );
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate, true);
    await this.safeLog('Стіл звільнено', {
      bookingId: id,
      staffId: actor?.staffId || null,
      staffName: actor?.name || null,
      role: actor?.role || 'admin',
    });
    return { message: 'Стіл звільнено' };
  }
"""
new_complete = """  async complete(id: string, actor?: AuthUser) {
    const { booking, previousData } = await this.bookings.manager.transaction(async (manager) => {
      const booking = await manager.getRepository(Booking).findOne({
        where: { id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');

      const previousData = this.bookingSnapshot(booking);
      booking.status = 'completed';
      if (!booking.completedAt) booking.completedAt = new Date();
      await manager.getRepository(Booking).save(booking);
      if (booking.client?.id) {
        await refreshClientVisitStats(manager, booking.client.id);
      }

      return { booking, previousData };
    });

    await this.saveHistory(
      booking,
      'booking_completed',
      actor?.role || 'admin',
      previousData,
      this.bookingSnapshot(booking),
      null,
      actor || null,
    );
    await this.setTableStatusOnlyForToday(booking.table, 'free', booking.bookingDate, true);
    await this.safeLog('Стіл звільнено', {
      bookingId: id,
      staffId: actor?.staffId || null,
      staffName: actor?.name || null,
      role: actor?.role || 'admin',
    });
    return { message: 'Стіл звільнено' };
  }
"""
if bookings.count(old_complete) != 1:
    raise SystemExit("BookingsService complete anchor mismatch")
bookings = bookings.replace(old_complete, new_complete, 1)
bookings_path.write_text(bookings)

stats_path = Path("backend/src/bookings/client-visit-stats.ts")
stats_path.write_text("""import { EntityManager } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { Booking } from './entities/booking.entity';

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
""")

telegram_path = Path("backend/src/bookings/guest-telegram-link.service.ts")
telegram = telegram_path.read_text()
telegram_import_anchor = "import { Booking } from './entities/booking.entity';\n"
telegram_import_line = "import { refreshClientVisitStats } from './client-visit-stats';\n"
if telegram_import_line not in telegram:
    if telegram.count(telegram_import_anchor) != 1:
        raise SystemExit("Telegram service import anchor mismatch")
    telegram = telegram.replace(
        telegram_import_anchor,
        telegram_import_anchor + telegram_import_line,
        1,
    )

old_reassign = """      const linkedClient = await clients.findOne({ where: { telegramId } });
      if (linkedClient && linkedClient.id !== client.id) {
        booking.client = linkedClient;
        await manager.getRepository(Booking).save(booking);
        return this.linkedResponse();
      }
"""
new_reassign = """      const linkedClient = await clients.findOne({ where: { telegramId } });
      if (linkedClient && linkedClient.id !== client.id) {
        const previousClientId = client.id;
        booking.client = linkedClient;
        await manager.getRepository(Booking).save(booking);

        if (booking.status === 'completed') {
          await refreshClientVisitStats(manager, previousClientId);
          await refreshClientVisitStats(manager, linkedClient.id);
        }

        return this.linkedResponse();
      }
"""
if telegram.count(old_reassign) != 1:
    raise SystemExit("Telegram reassignment anchor mismatch")
telegram = telegram.replace(old_reassign, new_reassign, 1)
telegram_path.write_text(telegram)

visit_test_path = Path("backend/test/guest-visit-stats.test.js")
visit_test_path.write_text(r"""require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');

function noopRepository() {
  return {};
}

test('guest identity reuses a client across Ukrainian local and international phone formats', async () => {
  const existingClient = {
    id: 'client-1',
    fullName: 'Іван',
    phone: '067 123 45 67',
  };
  const lookupValues = [];

  const clients = {
    async findOne({ where }) {
      lookupValues.push(where.phone);
      return typeof where.phone === 'string' ? null : existingClient;
    },
  };

  const service = new BookingsService(
    noopRepository(),
    noopRepository(),
    noopRepository(),
    clients,
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  const client = await service.findClientByPhone('+380 (67) 123-45-67');

  assert.equal(client, existingClient);
  assert.equal(lookupValues.length, 2);
  assert.deepEqual(
    service.phoneIdentityCandidates('+380 (67) 123-45-67'),
    ['380671234567', '0671234567'],
  );
  assert.deepEqual(
    service.phoneIdentityCandidates('067 123 45 67'),
    ['0671234567', '380671234567'],
  );
});

test('completing visits keeps completedAt stable and refreshes stats under row locks', async () => {
  const client = {
    id: 'client-1',
    fullName: 'Іван',
    phone: '+380671234567',
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const olderCompletedAt = new Date('2098-12-01T20:00:00.000Z');
  const booking = {
    id: 'booking-current',
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    wishes: '',
    guestsCount: 3,
    client,
    table: {
      id: 'table-1',
      tableNumber: '8',
      status: 'occupied',
    },
    checkedInAt: new Date('2099-01-01T17:00:00.000Z'),
    cancelledAt: null,
    cancellationReason: null,
    completedAt: null,
    expectedArrivalAt: null,
  };
  const previousBooking = {
    id: 'booking-old',
    status: 'completed',
    guestsCount: 2,
    completedAt: olderCompletedAt,
  };
  const bookingLocks = [];
  const clientLocks = [];
  const clientSaves = [];

  const bookingRepo = {
    async findOne({ lock }) {
      bookingLocks.push(lock?.mode || null);
      return booking;
    },
    async save(value) {
      return value;
    },
    createQueryBuilder() {
      return {
        leftJoin() { return this; },
        where() { return this; },
        andWhere() { return this; },
        async getMany() { return [previousBooking, booking]; },
      };
    },
  };
  const clientRepo = {
    async findOne({ where, lock }) {
      clientLocks.push(lock?.mode || null);
      return where.id === client.id ? client : null;
    },
    async save(value) {
      clientSaves.push({
        visitsCount: value.visitsCount,
        totalGuests: value.totalGuests,
        lastVisitAt: value.lastVisitAt,
      });
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepo;
      if (entity?.name === 'Client') return clientRepo;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const bookings = {
    manager: {
      transaction: async (callback) => callback(manager),
    },
  };
  const histories = {
    create(value) { return value; },
    async save(value) { return value; },
  };
  const tables = {
    async save() {
      throw new Error('future booking must not change today table status');
    },
  };
  const logs = { async create() {} };

  const service = new BookingsService(
    bookings,
    histories,
    {},
    {},
    tables,
    {},
    logs,
    {},
    {},
  );

  await service.complete('booking-current');
  const firstCompletedAt = booking.completedAt;
  const firstLastVisitAt = client.lastVisitAt;

  assert.equal(client.visitsCount, 2);
  assert.equal(client.totalGuests, 5);
  assert.ok(firstCompletedAt instanceof Date);
  assert.equal(firstLastVisitAt, firstCompletedAt);

  await service.complete('booking-current');

  assert.equal(client.visitsCount, 2);
  assert.equal(client.totalGuests, 5);
  assert.equal(booking.completedAt, firstCompletedAt);
  assert.equal(client.lastVisitAt, firstLastVisitAt);
  assert.deepEqual(bookingLocks, ['pessimistic_write', 'pessimistic_write']);
  assert.deepEqual(clientLocks, ['pessimistic_write', 'pessimistic_write']);
  assert.equal(clientSaves.length, 2);
  assert.deepEqual(
    clientSaves.map((item) => [item.visitsCount, item.totalGuests]),
    [[2, 5], [2, 5]],
  );
});
""")

telegram_stats_test_path = Path("backend/test/guest-telegram-completed-reassign.test.js")
telegram_stats_test_path.write_text(r"""require('reflect-metadata');

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  GuestTelegramLinkService,
} = require('../dist/bookings/guest-telegram-link.service.js');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

test('Telegram reassignment refreshes completed-visit stats for both clients', async () => {
  const bookingId = 'b5a6276d-cd57-4c8d-9368-f28dc881be67';
  const guestToken = 'owned-booking-token';
  const telegramId = '123456789';
  const completedAt = new Date('2099-02-03T20:00:00.000Z');

  const oldClient = {
    id: 'client-1',
    telegramId: null,
    visitsCount: 1,
    totalGuests: 4,
    lastVisitAt: completedAt,
  };
  const linkedClient = {
    id: 'client-2',
    telegramId,
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const booking = {
    id: bookingId,
    client: oldClient,
    status: 'completed',
    guestsCount: 4,
    completedAt,
  };

  const bookingParams = {};
  const statsClientIds = [];
  let bookingSaveCalls = 0;
  let clientSaveCalls = 0;

  const bookingRepository = {
    createQueryBuilder() {
      let mode = 'owned';
      return {
        leftJoinAndSelect() { return this; },
        leftJoin() {
          mode = 'stats';
          return this;
        },
        where(_sql, params) {
          Object.assign(bookingParams, params);
          if (params?.clientId) statsClientIds.push(params.clientId);
          return this;
        },
        andWhere(_sql, params) {
          Object.assign(bookingParams, params);
          return this;
        },
        setLock() { return this; },
        async getOne() {
          if (mode !== 'owned') return null;
          return (
            bookingParams.bookingId === bookingId &&
            bookingParams.guestAccessTokenHash === hashToken(guestToken)
          ) ? booking : null;
        },
        async getMany() {
          if (mode !== 'stats') return [];
          return booking.client?.id === bookingParams.clientId ? [booking] : [];
        },
      };
    },
    async save(value) {
      bookingSaveCalls += 1;
      return value;
    },
  };

  const clientRepository = {
    createQueryBuilder() {
      return {
        where() { return this; },
        setLock() { return this; },
        async getOne() { return oldClient; },
      };
    },
    async findOne({ where }) {
      if (where.telegramId === telegramId) return linkedClient;
      if (where.id === oldClient.id) return oldClient;
      if (where.id === linkedClient.id) return linkedClient;
      return null;
    },
    async save(value) {
      clientSaveCalls += 1;
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepository;
      if (entity?.name === 'Client') return clientRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const dataSource = {
    transaction: async (callback) => callback(manager),
  };

  const service = new GuestTelegramLinkService(dataSource);
  const result = await service.link(bookingId, guestToken, {
    sub: telegramId,
    telegramId,
    staffId: null,
    role: 'guest',
    name: 'Guest',
  });

  assert.equal(result.linked, true);
  assert.equal(booking.client, linkedClient);
  assert.deepEqual(statsClientIds, [oldClient.id, linkedClient.id]);
  assert.equal(oldClient.visitsCount, 0);
  assert.equal(oldClient.totalGuests, 0);
  assert.equal(oldClient.lastVisitAt, null);
  assert.equal(linkedClient.visitsCount, 1);
  assert.equal(linkedClient.totalGuests, 4);
  assert.equal(linkedClient.lastVisitAt, completedAt);
  assert.equal(bookingSaveCalls, 1);
  assert.equal(clientSaveCalls, 2);
});
""")
