const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const planner = fs.readFileSync(path.join(root, 'src/admin/AdminVisualTablePlanner.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/api/bookings.ts'), 'utf8');
const waiter = fs.readFileSync(path.join(root, 'src/waiter/WaiterAppV2.tsx'), 'utf8');

assert.match(planner, /Створити бронювання/);
assert.match(planner, /bookingsApi\.createManual\(\{/);
assert.match(planner, /tableId: selectedTable\.id/);
assert.match(planner, /bookingDate: manualDate/);
assert.match(planner, /bookingTime: manualTime/);
assert.match(planner, /Офіціант побачить його у своєму пульті тільки в день бронювання/);
assert.match(api, /\/bookings\/admin\/manual/);
assert.match(waiter, /bookingsApi\.getToday\(\)/);
assert.match(waiter, /setInterval\(\(\) => void load\(\), 15000\)/);

console.log('admin manual booking frontend regression passed');
