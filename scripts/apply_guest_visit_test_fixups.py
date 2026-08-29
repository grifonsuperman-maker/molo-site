from pathlib import Path

visit_test_path = Path("backend/test/guest-visit-stats.test.js")
visit_test = visit_test_path.read_text()
old_date = "const olderCompletedAt = new Date('2098-12-01T20:00:00.000Z');"
new_date = "const olderCompletedAt = new Date('2025-12-01T20:00:00.000Z');"
if visit_test.count(old_date) != 1:
    raise SystemExit("guest visit older date fixture mismatch")
visit_test_path.write_text(visit_test.replace(old_date, new_date, 1))

actor_test_path = Path("backend/test/booking-completion-actor.test.js")
actor_test = actor_test_path.read_text()
old_bookings = """  const bookings = {
    async findOne() {
      return booking;
    },
    async save(value) {
      return value;
    },
  };
"""
new_bookings = """  const bookingRepository = {
    async findOne() {
      return booking;
    },
    async save(value) {
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const bookings = {
    manager: {
      transaction: async (callback) => callback(manager),
    },
  };
"""
if actor_test.count(old_bookings) != 1:
    raise SystemExit("booking completion actor fixture mismatch")
actor_test_path.write_text(actor_test.replace(old_bookings, new_bookings, 1))
