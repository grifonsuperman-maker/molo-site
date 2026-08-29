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

test_path = Path('backend/test/booking-completion-actor.test.js')
test = test_path.read_text()
old_test = """  const savedHistory = [];
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
new_test = """  const savedHistory = [];
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
if test.count(old_test) != 1:
    raise SystemExit(f'Expected exactly one booking repository mock, found {test.count(old_test)}')
test = test.replace(old_test, new_test, 1)

old_assert = """  assert.deepEqual(result, { message: 'Стіл звільнено' });
  assert.equal(savedHistory.length, 1);
"""
new_assert = """  assert.deepEqual(result, { message: 'Стіл звільнено' });
  assert.deepEqual(completionLockCalls, [
    { mode: 'pessimistic_write', version: undefined, tables: ['booking'] },
  ]);
  assert.equal(savedHistory.length, 1);
"""
if test.count(old_assert) != 1:
    raise SystemExit(f'Expected exactly one completion result assertion, found {test.count(old_assert)}')
test_path.write_text(test.replace(old_assert, new_assert, 1))
