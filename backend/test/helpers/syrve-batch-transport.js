const { id } = require('./syrve-state-fixtures.js');
const GROUP = id(1);

// Synthetic Syrve HTTP only. Exercises the real client/parser/receipt issuer;
// no credentials, network calls or production database are used.
function batchTransport(organizationId, tableIds, options = {}) {
  const calls = [], groups = options.groups || [{ terminalGroupId: GROUP, posVersion: '7.7.1', tableIds }];
  let rows = options.rows || [], loads = 0;
  const plan = { organizationId, groups };
  const fetch = async (url, request) => {
    const path = new URL(url).pathname, body = JSON.parse(request.body);
    calls.push({ path, body });
    if (options.override) {
      const value = await options.override(path, body, calls);
      if (value !== undefined) return value instanceof Response ? value : Response.json(value);
    }
    let value;
    if (path.endsWith('/access_token')) value = { token: 'synthetic-batch-token' };
    else if (path.endsWith('/organizations')) value = { organizations: [{ id: organizationId, name: 'Тест' }] };
    else if (path.endsWith('/terminal_groups')) value = { terminalGroups: [{ organizationId, items: groups.map(group => ({
      id: group.terminalGroupId, organizationId, name: 'Каса', posVersion: group.posVersion })) }], terminalGroupsInSleep: [] };
    else if (path.endsWith('/available_restaurant_sections')) value = { restaurantSections: groups.map((group, index) => ({
      id: id(9000 + index), terminalGroupId: group.terminalGroupId, name: 'Зал', tables: group.tableIds.map((tableId, index) => ({
        id: tableId, number: index + 1, name: 'Стіл', isDeleted: false })) })) };
    else if (path.endsWith('/is_alive')) value = { correlationId: id(9001), isAliveStatus: groups.map(group => ({
      organizationId, terminalGroupId: group.terminalGroupId, isAlive: true })) };
    else if (path.endsWith('/init_by_table')) { loads++; value = { correlationId: id(9100 + loads) }; }
    else if (path.endsWith('/by_table')) value = { correlationId: id(9002), orders: rows.filter(row =>
      row.order?.tableIds.some(table => body.tableIds.includes(table)) || row.creationStatus !== 'Success') };
    else if (path.endsWith('/by_id')) value = { correlationId: id(9003), orders: rows.filter(row => body.orderIds.includes(row.id)) };
    else throw new Error('Unexpected synthetic Syrve path: ' + path);
    return Response.json(value);
  };
  return { fetch, calls, plan, setRows: value => { rows = value; } };
}
module.exports = { batchTransport };
