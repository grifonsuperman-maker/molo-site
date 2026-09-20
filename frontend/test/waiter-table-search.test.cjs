const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/waiter/WaiterTablesByLocation.tsx'), 'utf8');
const finderMatch = source.match(/function findExistingVisibleTable\([\s\S]*?\n}\n\nexport default function/);
assert.ok(finderMatch, 'the search must use the existing-table lookup');
const finderSource = finderMatch[0]
  .replace('tables: TableItem[], tableNumber: string): TableItem | null', 'tables, tableNumber)')
  .replace(/\n\nexport default function$/, '');
const findExistingVisibleTable = vm.runInNewContext(`${finderSource}\nfindExistingVisibleTable;`);

const tables = [
  { id: 'two', tableNumber: 2, isVisible: true },
  { id: 'hidden', tableNumber: 3, isVisible: false },
  { id: 'one-hundred', tableNumber: 100 },
];
const initialTables = JSON.stringify(tables);
assert.equal(findExistingVisibleTable(tables, '2'), tables[0]);
assert.equal(findExistingVisibleTable(tables, '100'), tables[2]);
assert.equal(findExistingVisibleTable(tables, '999'), null);
assert.equal(findExistingVisibleTable(tables, '3'), null, 'hidden tables are not search results');
assert.equal(findExistingVisibleTable(tables, '0'), null);
assert.equal(findExistingVisibleTable(tables, '02'), null, 'only actual table numbers match');
assert.equal(findExistingVisibleTable(tables, 'abc'), null);

const handlerMatch = source.match(/  function searchTable\(value: string\) \{[\s\S]*?\n  \}\n\n  function renderTable/);
assert.ok(handlerMatch, 'the table search handler must be present');
let inputValue = '';
const scrolled = [];
const lookedUpIds = [];
const searchTable = vm.runInNewContext(`(${handlerMatch[0]
  .replace('value: string', 'value')
  .replace(/\n\n  function renderTable$/, '')
  .trim()})`, {
  tables,
  findExistingVisibleTable,
  setTableSearch(value) { inputValue = value; },
  document: {
    getElementById(id) {
      lookedUpIds.push(id);
      return { scrollIntoView(options) { scrolled.push({ id, options }); } };
    },
  },
});

searchTable('999');
searchTable('3');
searchTable('abc');
assert.equal(inputValue, '');
assert.deepEqual(lookedUpIds, [], 'unknown and hidden tables must not trigger navigation');
assert.deepEqual(scrolled, []);
assert.equal(JSON.stringify(tables), initialTables, 'search must not create or alter tables');

searchTable('100');
assert.equal(inputValue, '100');
assert.deepEqual(lookedUpIds, ['waiter-table-one-hundred']);
assert.equal(scrolled[0].options.block, 'center', 'the existing card must be brought into view');
assert.match(source, /id=\{`waiter-table-\$\{table\.id\}`\}/);
assert.match(source, /value=\{tableSearch\}/);
assert.match(source, /occupied: 'border-\[3px\] border-\[#ff3b4f\].*shadow-\[/);
assert.match(source, /table\.status === 'occupied' \? 'ring-2 ring-\[#ff3b4f\]\/80'/);
assert.match(source, /const POLLING_MS = 15_000;/);
console.log('waiter table search and occupied neon regression passed');
