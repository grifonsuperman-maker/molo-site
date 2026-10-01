// Existing unit fixtures isolate business rules from transaction orchestration.
// Integration regressions exercise the real coordinator and PostgreSQL separately.
function repositoryStaffActions(tables, bookings = {}) {
  return { run: async (_id, _action, write) => write({ getRepository: (entity) => {
    if (entity.name === 'TableEntity') return tables;
    if (entity.name === 'Booking') return bookings;
    throw new Error(`Unexpected repository ${entity.name}`);
  } }) };
}
module.exports = { repositoryStaffActions };
