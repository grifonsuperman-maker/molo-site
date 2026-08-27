import { waiterAssignmentsFromBookings } from './waiterAssignments.js';

const assignments = waiterAssignmentsFromBookings([
  {
    id: 'booking-1',
    table: {
      id: 'table-8',
      tableNumber: '8',
      seats: 4,
      shape: 'rectangle',
      photoUrl: null,
      status: 'occupied',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0,
      isVisible: true,
    },
    client: null,
    bookingDate: '2026-08-17',
    bookingTime: '19:00:00',
    checkedInAt: '2026-08-17T06:00:00.000Z',
    assignedWaiterId: 'waiter-1',
    assignedWaiterName: 'Александр',
    guestsCount: 2,
    wishes: null,
    status: 'approved',
    source: 'mini_app',
    approvedAt: '2026-08-17T05:00:00.000Z',
    createdAt: '2026-08-17T04:00:00.000Z',
  },
  {
    id: 'booking-2',
    table: null,
    client: null,
    bookingDate: '2026-08-17',
    bookingTime: '20:00:00',
    guestsCount: 2,
    wishes: null,
    status: 'approved',
    source: 'mini_app',
    createdAt: '2026-08-17T04:30:00.000Z',
  },
]);

if (assignments.length !== 1) {
  throw new Error(`expected one waiter assignment, received ${assignments.length}`);
}

const [assignment] = assignments;
if (
  assignment.bookingId !== 'booking-1' ||
  assignment.tableId !== 'table-8' ||
  assignment.tableNumber !== '8' ||
  assignment.waiterId !== 'waiter-1' ||
  assignment.waiterName !== 'Александр' ||
  assignment.assignedAt !== '2026-08-17T06:00:00.000Z'
) {
  throw new Error(`unexpected waiter assignment: ${JSON.stringify(assignment)}`);
}

console.log('waiter assignment reconstruction test passed');
