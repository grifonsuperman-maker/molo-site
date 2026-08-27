const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(FRONTEND_ROOT, 'src');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function findCallableSource(name) {
  const matches = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const source = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
    const sourceFile = ts.createSourceFile(
      absolutePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === name
      ) {
        matches.push({
          file: absolutePath,
          source: node.getText(sourceFile),
        });
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        matches.push({
          file: absolutePath,
          source: `const ${node.getText(sourceFile)};`,
        });
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(
    matches.length,
    1,
    `Expected exactly one current callable named ${name}, found ${matches.length}`,
  );

  return matches[0];
}

function compileCallable(name, callableSource, dependencies) {
  const javascript = ts.transpileModule(callableSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  const dependencyNames = Object.keys(dependencies);
  const factory = new Function(
    ...dependencyNames,
    `${javascript}\nreturn ${name};`,
  );

  return factory(...dependencyNames.map((dependencyName) => dependencies[dependencyName]));
}

function runSelectVisualTableScenario(callableSource, { visualTable, realTable, fallbackTable }) {
  const calls = {
    lookupNumber: null,
    fallbackArgs: null,
    statusTable: null,
    activeNumber: null,
    selectedTable: null,
    delays: [],
  };

  const selectVisualTable = compileCallable('selectVisualTable', callableSource, {
    findRealTableByNumber(tableNumber) {
      calls.lookupNumber = tableNumber;
      return realTable;
    },
    createFallbackTable(tableNumber, seats) {
      calls.fallbackArgs = [tableNumber, seats];
      return fallbackTable;
    },
    getSelectableTableStatus(table) {
      calls.statusTable = table;
      return 'free';
    },
    setActiveTableNumber(tableNumber) {
      calls.activeNumber = tableNumber;
    },
    restaurant: { status: 'open' },
    setTableNotice() {},
    createTableNotice() {
      assert.fail('Available table must not create an unavailable-table notice');
    },
    isLocationClosed() {
      return false;
    },
    selectedLocationKey: 'hall',
    window: {
      setTimeout(callback, delay) {
        calls.delays.push(delay);
        callback();
        return 1;
      },
    },
    selectTable(table) {
      calls.selectedTable = table;
    },
  });

  selectVisualTable(visualTable);
  return calls;
}

test('guest map click selects the exact real or fallback table represented by the click zone', () => {
  const { source: callableSource } = findCallableSource('selectVisualTable');
  const visualRealTable = { number: 17, seats: 4 };
  const realTable = { id: 'db-17', tableNumber: 17, seats: 4 };

  const realCalls = runSelectVisualTableScenario(callableSource, {
    visualTable: visualRealTable,
    realTable,
    fallbackTable: null,
  });

  assert.equal(realCalls.lookupNumber, visualRealTable.number);
  assert.equal(realCalls.fallbackArgs, null);
  assert.equal(realCalls.statusTable, realTable);
  assert.equal(realCalls.activeNumber, visualRealTable.number);
  assert.equal(realCalls.selectedTable, realTable);
  assert.deepEqual(realCalls.delays, [650]);

  const visualFallbackTable = { number: 88, seats: 6 };
  const fallbackTable = {
    id: 'visual-88',
    tableNumber: 88,
    seats: 6,
  };
  const fallbackCalls = runSelectVisualTableScenario(callableSource, {
    visualTable: visualFallbackTable,
    realTable: undefined,
    fallbackTable,
  });

  assert.equal(fallbackCalls.lookupNumber, visualFallbackTable.number);
  assert.deepEqual(fallbackCalls.fallbackArgs, [
    visualFallbackTable.number,
    visualFallbackTable.seats,
  ]);
  assert.equal(fallbackCalls.statusTable, fallbackTable);
  assert.equal(fallbackCalls.activeNumber, visualFallbackTable.number);
  assert.equal(fallbackCalls.selectedTable, fallbackTable);
  assert.deepEqual(fallbackCalls.delays, [650]);
});

test('guest table statuses resolve to the protected neon colors and selected color', () => {
  const { source: callableSource } = findCallableSource('getTableNeonColor');
  const colors = Object.freeze({
    active: '#facc15',
    pending: '#38bdf8',
    reserved: '#fb923c',
    occupied: '#ff3b4f',
    cleaning: '#67e8f9',
    closed: '#bdbdbd',
    free: '#ffffff',
  });
  const getTableNeonColor = compileCallable('getTableNeonColor', callableSource, {
    STATUS_COLORS: colors,
  });

  for (const status of [
    'pending',
    'reserved',
    'occupied',
    'cleaning',
    'closed',
    'free',
  ]) {
    assert.equal(
      getTableNeonColor(status, false),
      colors[status],
      `${status} must resolve to its protected neon color`,
    );
  }

  assert.equal(
    getTableNeonColor('free', true),
    colors.active,
    'Selected table must use the protected selected color',
  );
});
