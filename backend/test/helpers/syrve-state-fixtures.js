const { parseSyrveOrders } = require('../../dist/syrve/syrve-order-observer.js');
const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GROUP = id(1);
function row(scope, orderId, status = 'New', timestamp = 100) {
  return { id: orderId, organizationId: scope.organizationId, timestamp, creationStatus: 'Success',
    order: { status, tableIds: [scope.syrveTableId], terminalGroupId: GROUP } };
}
function probe(scope, rows, orderIds = []) {
  const orders = parseSyrveOrders({ correlationId: id(2), orders: rows }, scope.organizationId, { tableIds: [scope.syrveTableId] });
  return { organizationId: scope.organizationId, startedAt: '2026-10-01T07:00:00Z', completedAt: '2026-10-01T07:00:01Z',
    authentication: 'legacy_v1', checks: Object.fromEntries(['connection', 'terminalGroups', 'restaurantSections',
      'posAvailability', 'ordersByTable', 'ordersById'].map((key) => [key, { status: 'ok', code: null }])),
    terminalGroups: { active: [{ id: GROUP }], sleeping: [] },
    catalogTables: [{ id: scope.syrveTableId, terminalGroupId: GROUP, isDeleted: false }],
    availability: [{ terminalGroupId: GROUP, isAlive: true }], byTable: orders,
    byId: structuredClone(orders.filter((order) => orderIds.includes(order.id))) };
}
function batches(captured, rows) {
  return captured.orderIds.map((orderIds) => {
    const value = probe(captured.state.scope, rows.filter((entry) => orderIds.includes(entry.id)), orderIds);
    value.byTable = probe(captured.state.scope, rows.slice(0, 1)).byTable;
    return { orderIds, probe: value };
  });
}
module.exports = { id, row, probe, batches };
