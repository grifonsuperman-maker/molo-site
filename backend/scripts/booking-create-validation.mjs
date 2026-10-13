import assert from 'node:assert/strict';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget, lockFreshSchemaReferenceEnvironment } from './fresh-schema-reference.mjs';

export async function runBookingCreateValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Booking creation validation must use the validated process environment.');
  lockFreshSchemaReferenceEnvironment(env);
  const require = createRequire(import.meta.url);
  const { DataSource, In } = require('typeorm');
  const { BookingsService } = require('../dist/bookings/bookings.service.js');
  const { GuestBookingsService } = require('../dist/bookings/guest-bookings.service.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
  const { BookingRescheduleRequest } = require('../dist/bookings/entities/booking-reschedule-request.entity.js');
  const { GuestReview } = require('../dist/bookings/entities/guest-review.entity.js');
  const { Client } = require('../dist/clients/entities/client.entity.js');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Restaurant } = require('../dist/restaurant/entities/restaurant.entity.js');
  const { BookingTableLockService } = require('../dist/bookings/booking-table-lock.service.js');
  const { BookingTableChangeRequest } = require('../dist/bookings/entities/booking-table-change-request.entity.js');
  const source = new DataSource({
    type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, entities: [resolve(dirname(fileURLToPath(import.meta.url)), '../dist/**/*.entity.js')],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 },
  });
  await source.initialize();
  const tables = source.getRepository(TableEntity);
  const bookings = source.getRepository(Booking);
  const histories = source.getRepository(BookingHistory);
  const clients = source.getRepository(Client);
  const restaurants = source.getRepository(Restaurant);
  const tableIds = [];
  const phones = [];
  let tableNumber = 0;
  const prefix = `creation-ci-${randomUUID()}`;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const effects = [];
  const onNotify = async (booking) => {
    // A separate pooled connection must already see the complete commit.
    assert.equal(await histories.countBy({ booking: { id: booking.id } }), 1);
    assert.ok(await bookings.findOneBy({ id: booking.id }));
    effects.push(['notify', booking.id]);
  };
  const makeService = (interceptRepository) => {
    let bookingRepository = bookings;
    if (interceptRepository) {
      const manager = new Proxy(source.manager, { get(target, property) {
        if (property === 'transaction') return (work) => target.transaction((transaction) => {
          const scoped = new Proxy(transaction, { get(actual, key) {
            if (key === 'getRepository') return (entity) => interceptRepository(entity, actual.getRepository(entity));
            const value = Reflect.get(actual, key, actual);
            return typeof value === 'function' ? value.bind(actual) : value;
          } });
          return work(scoped);
        });
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      bookingRepository = new Proxy(bookings, { get(target, property) {
        if (property === 'manager') return manager;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    return new BookingsService(
      bookingRepository, histories, source.getRepository(BookingRescheduleRequest), clients, tables, restaurants,
      { async create() { effects.push(['log']); } },
      { notifyNewBooking: onNotify, notifyManualBookingCreated: onNotify }, {}, {},
    );
  };
  const service = makeService();
  const newTable = async () => {
    const table = await tables.save(tables.create({ tableNumber: `${prefix}-${tableNumber++}`, seats: 8, status: 'free' }));
    tableIds.push(table.id);
    return table;
  };
  const dtoFor = (table, values = {}) => {
    const phone = `+380${randomInt(100000000, 999999999)}`;
    const dto = {
      tableId: table.id, bookingDate: today, bookingTime: '16:00', durationMinutes: 120,
      fullName: 'Тест створення', guestsCount: 2, phone, guestDeviceId: randomUUID(), ...values,
    };
    if (dto.phone) phones.push(dto.phone);
    return dto;
  };
  const physicalStatus = async (table) => (await tables.findOneByOrFail({ id: table.id })).status;
  const assertOneWinner = (results) => {
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    const failure = results.find((item) => item.status === 'rejected').reason;
    assert.equal(failure.getStatus(), 400);
    assert.match(failure.message, /активне бронювання|Стіл зайнятий/);
  };
  try {
    // Real transaction failures after an actual INSERT/UPDATE: no orphan booking,
    // first-time Client, history or notification may survive either failure.
    for (const action of ['create', 'createManual']) {
      for (const failedEntity of [BookingHistory, TableEntity]) {
        const table = await newTable();
        const dto = dtoFor(table);
        const before = effects.length;
        const failing = makeService((entity, repository) => entity !== failedEntity ? repository : new Proxy(repository, {
          get(target, property) {
            if (property === 'save') return async (...args) => {
              await target.save(...args);
              throw new Error('synthetic failure after database write');
            };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }));
        await assert.rejects(failing[action](dto), (error) => error.getStatus() === 500 &&
          error.message === 'Не вдалося створити бронювання. Спробуйте ще раз.');
        assert.equal(await bookings.countBy({ table: { id: table.id } }), 0);
        assert.equal(await clients.countBy({ phone: dto.phone }), 0);
        assert.equal(await physicalStatus(table), 'free');
        assert.equal(effects.length, before);
        const retried = await service[action](dto);
        assert.equal(await histories.countBy({ booking: { id: retried.bookingId } }), 1);
        assert.equal(await physicalStatus(table), action === 'create' ? 'pending' : 'reserved');
      }
    }

    // Deterministically hold a staff/Syrve-like physical UPDATE uncommitted.
    // The guest's first read sees FREE, then its locking read must wait and
    // re-evaluate the committed OCCUPIED/CLEANING/CLOSED state.
    for (const action of ['create', 'createManual']) {
      for (const status of ['occupied', 'cleaning', 'closed']) {
        const table = await newTable();
        const dto = dtoFor(table);
        const writer = source.createQueryRunner();
        const reachedLock = Promise.withResolvers();
        const originalReads = [];
        const racing = makeService((entity, repository) => entity !== TableEntity ? repository : new Proxy(repository, {
          get(target, property) {
            if (property === 'findOne') return async (...args) => {
              const value = await target.findOne(...args);
              originalReads.push(value?.status);
              return value;
            };
            if (property === 'createQueryBuilder') return (...args) => {
              const query = target.createQueryBuilder(...args);
              const getOne = query.getOne.bind(query);
              query.getOne = () => { reachedLock.resolve(); return getOne(); };
              return query;
            };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }));
        await writer.connect();
        await writer.startTransaction();
        let pending;
        try {
          await writer.manager.getRepository(TableEntity).update(table.id, { status });
          // Attach rejection immediately, including when a regression fails before the gate.
          pending = racing[action](dto).then((value) => ({ value }), (error) => ({ error }));
          const first = await Promise.race([reachedLock.promise.then(() => 'lock'), pending]);
          assert.equal(first, 'lock');
          if (action === 'create') assert.deepEqual(originalReads, ['free']);
          await writer.commitTransaction();
          const result = await pending;
          if (status === 'closed') {
            assert.equal(result.error?.getStatus(), 400);
            assert.equal(await bookings.countBy({ table: { id: table.id } }), 0);
            assert.equal(await clients.countBy({ phone: dto.phone }), 0);
          } else {
            assert.ok(result.value, result.error?.message);
            assert.equal(await histories.countBy({ booking: { id: result.value.bookingId } }), 1);
          }
          assert.equal(await physicalStatus(table), status);
        } finally {
          if (writer.isTransactionActive) await writer.rollbackTransaction();
          await pending;
          await writer.release();
        }
      }
    }

    // Duplicate phone/device protections survive different tables and instances.
    for (const identity of ['phone', 'guestDeviceId']) {
      const [left, right] = await Promise.all([newTable(), newTable()]);
      const first = dtoFor(left);
      const second = dtoFor(right, { [identity]: first[identity] });
      const results = await Promise.allSettled([service.create(first), service.create(second)]);
      assertOneWinner(results);
      assert.equal(await bookings.countBy({ table: { id: In([left.id, right.id]) } }), 1);
      if (identity === 'phone') assert.equal(await clients.countBy({ phone: first.phone }), 1);
    }
    const conflictTable = await newTable();
    assertOneWinner(await Promise.allSettled([
      service.create(dtoFor(conflictTable)), service.createManual(dtoFor(conflictTable)),
    ]));

    // Same phone on different dates can create its Client concurrently without a 23505.
    const [firstTable, secondTable] = await Promise.all([newTable(), newTable()]);
    const firstDto = dtoFor(firstTable, { bookingDate: '2099-01-01' });
    const secondDto = dtoFor(secondTable, { phone: firstDto.phone, guestDeviceId: firstDto.guestDeviceId, bookingDate: '2099-01-02' });
    const cards = await Promise.all([service.create(firstDto), service.create(secondDto)]);
    assert.equal(await clients.countBy({ phone: firstDto.phone }), 1);
    assert.equal(await physicalStatus(firstTable), 'free');
    assert.equal(await physicalStatus(secondTable), 'free');
    assert.notEqual(cards[0].guestAccessToken, cards[1].guestAccessToken);
    const stored = await bookings.createQueryBuilder('booking')
      .addSelect(['booking.guestAccessTokenHash', 'booking.guestDeviceIdHash'])
      .where('booking.id = :id', { id: cards[0].bookingId }).getOne();
    assert.equal(stored.guestAccessTokenHash, createHash('sha256').update(cards[0].guestAccessToken).digest('hex'));
    assert.equal(stored.guestDeviceIdHash, createHash('sha256').update(firstDto.guestDeviceId).digest('hex'));
    const guest = new GuestBookingsService(bookings, source.getRepository(GuestReview), restaurants, source);
    assert.ok(await guest.get(cards[0].bookingId, cards[0].guestAccessToken));
    await assert.rejects(guest.get(cards[0].bookingId, cards[1].guestAccessToken), /Недійсний доступ/);
    const list = await guest.list({ guestDeviceId: firstDto.guestDeviceId, tokens: cards.map((card) => card.guestAccessToken) });
    assert.equal(list.length, 2);
    assert.doesNotMatch(JSON.stringify(list), /guestAccessTokenHash|guestDeviceIdHash|guestPhoneNormalized/);
    for (const status of ['cancelled', 'completed']) {
      await bookings.update(cards[0].bookingId, { status });
      cards[0] = await service.create(firstDto);
    }

    // The controller holds its existing session advisory lock on another pooled
    // connection. Creation must not deadlock by re-acquiring that same key.
    const lockedTable = await newTable();
    const lockedDto = dtoFor(lockedTable);
    const locks = new BookingTableLockService(source, tables, bookings, source.getRepository(BookingTableChangeRequest), clients);
    const locked = await locks.withCreateLock(lockedDto, () => service.create(lockedDto));
    assert.equal(await histories.countBy({ booking: { id: locked.bookingId } }), 1);

    // Manual bookings without phone create no synthetic Client.
    const phoneLessTable = await newTable();
    const beforeClients = await clients.count();
    const phoneLess = await service.createManual(dtoFor(phoneLessTable, { phone: undefined }));
    const manual = await bookings.findOne({ where: { id: phoneLess.bookingId }, relations: ['client'] });
    assert.equal(manual.client, null);
    assert.equal(manual.guestName, 'Тест створення');
    assert.equal(await clients.count(), beforeClients);
  } finally {
    try {
      if (tableIds.length) await bookings.delete({ table: { id: In(tableIds) } });
      if (phones.length) await clients.delete({ phone: In(phones) });
      if (tableIds.length) await tables.delete({ id: In(tableIds) });
    } finally {
      await source.destroy();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBookingCreateValidation()
    .then(() => process.stdout.write('Booking creation PostgreSQL validation passed.\n'))
    .catch((error) => { console.error(`Booking creation validation failed: ${error.message}`); process.exitCode = 1; });
}
