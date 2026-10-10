import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

const ROLLBACK = new Error('BOOKING_STATUS_CI_ROLLBACK');

export async function runBookingStatusValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Booking status validation must use the validated process environment.');

  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { BookingsService } = require('../dist/bookings/bookings.service.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
  const { BookingRescheduleRequest } = require('../dist/bookings/entities/booking-reschedule-request.entity.js');
  const { Client } = require('../dist/clients/entities/client.entity.js');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Restaurant } = require('../dist/restaurant/entities/restaurant.entity.js');
  const { CreateBookingTableAssignments2026100200010 } = require('../dist/migrations/2026100200010-CreateBookingTableAssignments.js');
  const source = new DataSource({
    type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, entities: [resolve(dirname(fileURLToPath(import.meta.url)), '../dist/**/*.entity.js')],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 },
  });

  await source.initialize();
  try {
    await assert.rejects(source.transaction(async (manager) => {
      const tables = manager.getRepository(TableEntity);
      const bookings = manager.getRepository(Booking);
      const histories = manager.getRepository(BookingHistory);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const table = await tables.save(tables.create({
        tableNumber: `status-ci-${Date.now()}`, status: 'reserved', seats: 8,
      }));
      const secondary = await tables.save(tables.create({
        tableNumber: `${table.tableNumber}-secondary`, status: 'free', seats: 8,
      }));
      const service = new BookingsService(
        bookings, histories, manager.getRepository(BookingRescheduleRequest),
        manager.getRepository(Client), tables, manager.getRepository(Restaurant),
        { async create() {} }, { async notifyBookingCancelled() {}, async notifyManualBookingCreated() {} }, {}, {},
      );
      const createBooking = (values = {}) => bookings.save(bookings.create({
        table, bookingDate: today, bookingTime: '16:00', guestsCount: 4,
        durationMinutes: 120, status: 'approved', source: 'admin_manual', ...values,
      }));
      const physicalStatus = async (id = table.id) => (await tables.findOneByOrFail({ id })).status;

      // Use real repositories, transactions and PostgreSQL for every terminal button.
      for (const [action, expected] of [
        ['cancel', 'cancelled'], ['reject', 'rejected'], ['noShow', 'cancelled'], ['complete', 'completed'],
      ]) {
        await tables.update(table.id, { status: 'reserved' });
        const booking = await createBooking();
        await service[action](booking.id);
        assert.equal((await bookings.findOneByOrFail({ id: booking.id })).status, expected);
        assert.equal(await physicalStatus(), 'free');
        assert.equal(await histories.countBy({ booking: { id: booking.id } }), 1);
      }

      // Verify check-in independently, then complete a visit using the same service.
      await tables.update(table.id, { status: 'reserved' });
      const visit = await createBooking();
      await service.checkIn(visit.id);
      assert.ok((await bookings.findOneByOrFail({ id: visit.id })).checkedInAt instanceof Date);
      assert.equal(await physicalStatus(), 'occupied');
      await service.complete(visit.id);
      assert.equal(await physicalStatus(), 'free');
      assert.equal(await histories.countBy({ booking: { id: visit.id } }), 2);

      // Cancellation retains later staff marks and remaining reservations.
      for (const status of ['occupied', 'cleaning', 'closed']) {
        await tables.update(table.id, { status });
        await service.cancel((await createBooking()).id);
        assert.equal(await physicalStatus(), status);
      }
      await tables.update(table.id, { status: 'reserved' });
      const remaining = await createBooking({ bookingTime: '20:00' });
      await service.cancel((await createBooking()).id);
      assert.equal(await physicalStatus(), 'reserved');
      await service.cancel(remaining.id);
      assert.equal(await physicalStatus(), 'free');

      // Future reservations never change today's physical table.
      await tables.update(table.id, { status: 'cleaning' });
      await service.cancel((await createBooking({ bookingDate: '2099-01-01' })).id);
      assert.equal(await physicalStatus(), 'cleaning');

      // Failure after booking/history writes must roll all three records back.
      await tables.update(table.id, { status: 'reserved' });
      const failed = await createBooking();
      await manager.query(`CREATE FUNCTION molo_booking_status_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic booking table failure'; END $$`);
      await manager.query('CREATE TRIGGER booking_status_ci_failure BEFORE UPDATE ON public.tables FOR EACH ROW EXECUTE FUNCTION molo_booking_status_ci_fail()');
      await assert.rejects(service.cancel(failed.id), /synthetic booking table failure/);
      assert.equal((await bookings.findOneByOrFail({ id: failed.id })).status, 'approved');
      assert.equal(await histories.countBy({ booking: { id: failed.id } }), 0);
      assert.equal(await physicalStatus(), 'reserved');
      await manager.query('DROP FUNCTION molo_booking_status_ci_fail() CASCADE');
      await service.cancel(failed.id);

      // Adopt assignments only inside this rollback transaction, then exercise
      // the joined banquet lock and cancellation of primary/secondary tables.
      const migration = new CreateBookingTableAssignments2026100200010();
      await migration.up({ isTransactionActive: true, connection: source, query: manager.query.bind(manager) });
      await tables.update(table.id, { status: 'free' });
      const banquet = await service.createManualBanquet({
        tableIds: [table.id, secondary.id], primaryTableId: table.id,
        fullName: 'Тест банкету', bookingDate: today, bookingTime: '18:00', guestsCount: 8,
      });
      assert.equal(await physicalStatus(), 'reserved');
      assert.equal(await physicalStatus(secondary.id), 'reserved');
      await service.cancel(banquet.bookingId);
      assert.equal(await physicalStatus(), 'free');
      assert.equal(await physicalStatus(secondary.id), 'free');
      assert.equal(await histories.countBy({ booking: { id: banquet.bookingId } }), 2);

      throw ROLLBACK;
    }), (error) => error === ROLLBACK);
  } finally {
    await source.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBookingStatusValidation()
    .then(() => process.stdout.write('Booking status PostgreSQL validation passed.\n'))
    .catch((error) => {
      console.error(`Booking status validation failed: ${error.message}`);
      process.exitCode = 1;
    });
}
