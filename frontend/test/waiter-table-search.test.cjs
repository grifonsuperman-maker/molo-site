const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/waiter/WaiterTablesByLocation.tsx'), 'utf8');
const finderMatch = source.match(/function findExistingVisibleTable\([\s\S]*?\n}\n\nfunction prioritizeExistingTable/);
assert.ok(finderMatch, 'the search must use the existing-table lookup');
const finderSource = finderMatch[0]
  .replace('tables: TableItem[], tableNumber: string): TableItem | null', 'tables, tableNumber)')
  .replace(/\n\nfunction prioritizeExistingTable$/, '');
const findExistingVisibleTable = vm.runInNewContext(`${finderSource}\nfindExistingVisibleTable;`);

const priorityMatch = source.match(/function prioritizeExistingTable\([\s\S]*?\n}\n\nexport default function/);
assert.ok(priorityMatch, 'the search must prioritize the existing matching card');
const prioritySource = priorityMatch[0]
  .replace('tables: TableItem[], matchedTable: TableItem | null): TableItem[]', 'tables, matchedTable)')
  .replace(/\n\nexport default function$/, '');
const prioritizeExistingTable = vm.runInNewContext(`${prioritySource}\nprioritizeExistingTable;`);

const tables = [
  { id: 'one', tableNumber: 1, isVisible: true },
  { id: 'fourteen', tableNumber: 14, isVisible: true },
  { id: 'hidden', tableNumber: 3, isVisible: false },
  { id: 'one-hundred', tableNumber: 100 },
  { id: 'unassigned', tableNumber: 999 },
];
const initialTables = JSON.stringify(tables);
assert.equal(findExistingVisibleTable(tables, '14'), tables[1]);
assert.equal(findExistingVisibleTable(tables, '100'), tables[3]);
assert.equal(findExistingVisibleTable(tables, '999'), tables[4]);
assert.equal(findExistingVisibleTable(tables, '987'), null);
assert.equal(findExistingVisibleTable(tables, '3'), null, 'hidden tables are not search results');
assert.equal(findExistingVisibleTable(tables, '0'), null);
assert.equal(findExistingVisibleTable(tables, '014'), null, 'only actual table numbers match');
assert.equal(findExistingVisibleTable(tables, 'abc'), null);

const hall = [tables[0], tables[1]];
const originalHall = JSON.stringify(hall);
const prioritizedHall = prioritizeExistingTable(hall, findExistingVisibleTable(tables, '14'));
assert.equal(prioritizedHall[0], tables[1], 'table 14 must appear first while typing with the keyboard open');
assert.deepEqual(Array.from(prioritizedHall, (table) => table.id), ['fourteen', 'one']);
assert.equal(prioritizedHall.length, hall.length, 'search cannot add or duplicate any table');
assert.equal(JSON.stringify(hall), originalHall, 'search must not change the original location order');
assert.equal(prioritizeExistingTable(hall, findExistingVisibleTable(tables, '100')), hall, 'other locations are untouched');
assert.equal(prioritizeExistingTable(hall, findExistingVisibleTable(tables, '987')), hall, 'unknown numbers do nothing');
assert.equal(prioritizeExistingTable(hall, findExistingVisibleTable(tables, '3')), hall, 'hidden numbers do nothing');
const unassigned = [tables[4]];
assert.equal(prioritizeExistingTable(unassigned, findExistingVisibleTable(tables, '999'))[0], tables[4]);

const handlerMatch = source.match(/  function searchTable\(value: string\) \{[\s\S]*?\n  \}\n\n  function renderTable/);
assert.ok(handlerMatch, 'the table search handler must be present');
let inputValue = '';
const searchTableSource = handlerMatch[0]
  .replace('value: string', 'value')
  .replace(/\n\n  function renderTable$/, '')
  .trim();
assert.doesNotMatch(searchTableSource, /scrollIntoView|waiterStatus|create/i, 'typing must not scroll with an active mobile keyboard or write tables');
const searchTable = vm.runInNewContext(`(${searchTableSource})`, {
  setTableSearch(value) { inputValue = value; },
});
searchTable('14');
assert.equal(inputValue, '14');
searchTable('987');
assert.equal(inputValue, '987');
searchTable('14abc');
assert.equal(inputValue, '14');
assert.equal(JSON.stringify(tables), initialTables, 'search must not create or alter tables');

assert.match(source, /const searchedTable = findExistingVisibleTable\(tables, tableSearch\);/);
assert.match(source, /const orderedLocationGroups = searchedLocation/);
assert.match(source, /prioritizeExistingTable\(searchedLocation\.tables, searchedTable\)/);
assert.match(source, /\{orderedLocationGroups\.map\(\(location\) => \(/);
assert.match(source, /\{searchedUnassigned && unassignedSection\}/);
assert.match(source, /\{!searchedUnassigned && unassignedSection\}/);
assert.match(source, /id=\{`waiter-table-\$\{table\.id\}`\}/);
assert.match(source, /value=\{tableSearch\}/);
assert.match(source, /occupied: 'border-\[3px\] border-\[#ff3b4f\].*shadow-\[/);
assert.match(source, /table\.status === 'occupied' \? 'ring-2 ring-\[#facc15\]'/);
assert.match(source, /disabled=\{loading\}\s+placeholder="Номер столу"/);
assert.match(source, /scroll-mt-64 rounded-\[28px\]/);
assert.match(source, /const POLLING_MS = 15_000;/);
console.log('waiter mobile table search and occupied neon regression passed');
