from pathlib import Path

service_path = Path('backend/src/bookings/bookings.service.ts')
service = service_path.read_text()
old = """      const booking = await manager.getRepository(Booking).findOne({
        where: { id },
        relations: ['table', 'client'],
        lock: { mode: 'pessimistic_write' },
      });
"""
new = """      const booking = await manager
        .getRepository(Booking)
        .createQueryBuilder('booking')
        .leftJoinAndSelect('booking.table', 'table')
        .leftJoinAndSelect('booking.client', 'client')
        .where('booking.id = :id', { id })
        .setLock('pessimistic_write', undefined, ['booking'])
        .getOne();
"""
if service.count(old) != 1:
    raise SystemExit(f'Expected exactly one completion lock block, found {service.count(old)}')
service_path.write_text(service.replace(old, new, 1))

actor_test_path = Path('backend/test/booking-completion-actor.test.js')
actor_test = actor_test_path.read_text()
old_actor_repo = """  const savedHistory = [];
  const logged = [];

  const bookingRepository = {
    async findOne() {
      return booking;
    },
    async save(value) {
      return value;
    },
  };
"""
new_actor_repo = """  const savedHistory = [];
  const logged = [];
  const completionLockCalls = [];

  const bookingRepository = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'booking');
      return {
        leftJoinAndSelect() {
          return this;
        },
        where() {
          return this;
        },
        setLock(mode, version, tables) {
          completionLockCalls.push({ mode, version, tables });
          return this;
        },
        async getOne() {
          return booking;
        },
      };
    },
    async save(value) {
      return value;
    },
  };
"""
if actor_test.count(old_actor_repo) != 1:
    raise SystemExit(f'Expected exactly one actor booking repository mock, found {actor_test.count(old_actor_repo)}')
actor_test = actor_test.replace(old_actor_repo, new_actor_repo, 1)
old_actor_assert = """  assert.deepEqual(result, { message: 'Стіл звільнено' });
  assert.equal(savedHistory.length, 1);
"""
new_actor_assert = """  assert.deepEqual(result, { message: 'Стіл звільнено' });
  assert.deepEqual(completionLockCalls, [
    { mode: 'pessimistic_write', version: undefined, tables: ['booking'] },
  ]);
  assert.equal(savedHistory.length, 1);
"""
if actor_test.count(old_actor_assert) != 1:
    raise SystemExit(f'Expected exactly one actor completion assertion, found {actor_test.count(old_actor_assert)}')
actor_test_path.write_text(actor_test.replace(old_actor_assert, new_actor_assert, 1))

stats_test_path = Path('backend/test/guest-visit-stats.test.js')
stats_test = stats_test_path.read_text()
old_stats_repo = """  const bookingRepo = {
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
"""
new_stats_repo = """  const bookingRepo = {
    async save(value) {
      return value;
    },
    createQueryBuilder() {
      return {
        leftJoinAndSelect() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        andWhere() { return this; },
        setLock(mode, version, tables) {
          bookingLocks.push({ mode, version, tables });
          return this;
        },
        async getOne() { return booking; },
        async getMany() { return [previousBooking, booking]; },
      };
    },
  };
"""
if stats_test.count(old_stats_repo) != 1:
    raise SystemExit(f'Expected exactly one stats booking repository mock, found {stats_test.count(old_stats_repo)}')
stats_test = stats_test.replace(old_stats_repo, new_stats_repo, 1)
old_stats_assert = """  assert.deepEqual(bookingLocks, ['pessimistic_write', 'pessimistic_write']);
  assert.deepEqual(clientLocks, ['pessimistic_write', 'pessimistic_write']);
"""
new_stats_assert = """  assert.deepEqual(bookingLocks, [
    { mode: 'pessimistic_write', version: undefined, tables: ['booking'] },
    { mode: 'pessimistic_write', version: undefined, tables: ['booking'] },
  ]);
  assert.deepEqual(clientLocks, ['pessimistic_write', 'pessimistic_write']);
"""
if stats_test.count(old_stats_assert) != 1:
    raise SystemExit(f'Expected exactly one stats lock assertion, found {stats_test.count(old_stats_assert)}')
stats_test_path.write_text(stats_test.replace(old_stats_assert, new_stats_assert, 1))
