const assert = require('node:assert/strict');
const test = require('node:test');

const { StaffService } = require('../dist/staff/staff.service.js');

function createService(staff) {
  const savedEvents = [];
  const staffRepo = {
    find: async () => (staff.isOnShift ? [staff] : []),
    save: async (value) => value,
  };
  const shiftEventRepo = {
    create: (value) => value,
    save: async (value) => {
      savedEvents.push(value);
      return value;
    },
  };

  return {
    service: new StaffService(staffRepo, shiftEventRepo, {}),
    savedEvents,
  };
}

test('keeps a same-day shift open before 23:01 Kyiv time', async () => {
  const staff = {
    id: 'waiter-1',
    isOnShift: true,
    shiftStartedAt: new Date('2026-08-07T17:00:00.000Z'),
  };
  const { service, savedEvents } = createService(staff);

  await service.closeMissedShifts(new Date('2026-08-07T20:00:00.000Z'));

  assert.equal(staff.isOnShift, true);
  assert.equal(savedEvents.length, 0);
});

test('closes a same-day shift at 23:01 Kyiv time', async () => {
  const staff = {
    id: 'waiter-1',
    isOnShift: true,
    shiftStartedAt: new Date('2026-08-07T17:00:00.000Z'),
  };
  const { service, savedEvents } = createService(staff);

  await service.closeMissedShifts(new Date('2026-08-07T20:01:00.000Z'));

  assert.equal(staff.isOnShift, false);
  assert.equal(staff.lastAutoShiftEndDate, '2026-08-07');
  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0].eventType, 'shift_auto_ended');
});

test('closes a carried-over shift when the server restarts next day', async () => {
  const staff = {
    id: 'hookah-1',
    isOnShift: true,
    shiftStartedAt: new Date('2026-08-07T17:00:00.000Z'),
  };
  const { service, savedEvents } = createService(staff);

  await service.closeMissedShifts(new Date('2026-08-08T06:00:00.000Z'));

  assert.equal(staff.isOnShift, false);
  assert.equal(staff.lastAutoShiftEndDate, '2026-08-08');
  assert.equal(savedEvents.length, 1);
});
