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

function parseSourceFile(absolutePath) {
  const source = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return { source, sourceFile };
}

function findCallableSource(name, marker = null) {
  const matches = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const { sourceFile } = parseSourceFile(absolutePath);

    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        const callableSource = node.getText(sourceFile);
        if (!marker || callableSource.includes(marker)) {
          matches.push({ file: absolutePath, source: callableSource });
        }
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        const callableSource = `const ${node.getText(sourceFile)};`;
        if (!marker || callableSource.includes(marker)) {
          matches.push({ file: absolutePath, source: callableSource });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(
    matches.length,
    1,
    `Expected exactly one production callable named ${name}${marker ? ` containing ${marker}` : ''}, found ${matches.length}`,
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

function compileHandler(handlerSource, dependencies) {
  const javascript = ts.transpileModule(`const __handler = ${handlerSource};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  const dependencyNames = Object.keys(dependencies);
  const factory = new Function(
    ...dependencyNames,
    `${javascript}\nreturn __handler;`,
  );
  return factory(...dependencyNames.map((dependencyName) => dependencies[dependencyName]));
}

function jsxText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, ' ');
}

function findButtonHandler(label, callableName) {
  const matches = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    if (!absolutePath.endsWith('.tsx')) continue;
    const { sourceFile } = parseSourceFile(absolutePath);

    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'button') {
        const text = jsxText(node, sourceFile);
        if (!text.includes(label)) {
          ts.forEachChild(node, visit);
          return;
        }

        const onClick = node.openingElement.attributes.properties.find(
          (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText(sourceFile) === 'onClick' &&
            property.initializer &&
            ts.isJsxExpression(property.initializer) &&
            property.initializer.expression,
        );

        if (
          onClick &&
          ts.isJsxAttribute(onClick) &&
          ts.isJsxExpression(onClick.initializer) &&
          onClick.initializer.expression
        ) {
          const handlerSource = onClick.initializer.expression.getText(sourceFile);
          if (handlerSource.includes(callableName)) {
            matches.push({ file: absolutePath, handlerSource });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(
    matches.length,
    1,
    `Expected one ${label} button wired to ${callableName}, found ${matches.length}`,
  );
  return matches[0];
}

function findClickZoneBinding() {
  const matches = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    if (!absolutePath.endsWith('.tsx')) continue;
    const { sourceFile } = parseSourceFile(absolutePath);

    function visit(node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(sourceFile) === 'ClickZone'
      ) {
        const onPick = node.attributes.properties.find(
          (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText(sourceFile) === 'onPick' &&
            property.initializer &&
            ts.isJsxExpression(property.initializer) &&
            property.initializer.expression,
        );

        if (
          onPick &&
          ts.isJsxAttribute(onPick) &&
          ts.isJsxExpression(onPick.initializer) &&
          onPick.initializer.expression
        ) {
          matches.push(onPick.initializer.expression.getText(sourceFile));
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(matches.length, 1, `Expected one rendered ClickZone, found ${matches.length}`);
  return matches[0];
}

function runSelectVisualTableScenario(callableSource, { visualTable, realTable, fallbackTable }) {
  const calls = {
    lookupNumber: null,
    fallbackArgs: null,
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
    getSelectableTableStatus() {
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

function numericValue(expression, sourceFile) {
  if (!expression) return null;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);

  if (ts.isParenthesizedExpression(expression)) {
    return numericValue(expression.expression, sourceFile);
  }

  if (ts.isBinaryExpression(expression)) {
    const left = numericValue(expression.left, sourceFile);
    const right = numericValue(expression.right, sourceFile);
    if (left === null || right === null) return null;
    if (expression.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  }

  if (ts.isIdentifier(expression)) {
    let value = null;
    function visit(node) {
      if (
        value === null &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === expression.text &&
        node.initializer
      ) {
        value = numericValue(node.initializer, sourceFile);
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return value;
  }

  return null;
}

function unwrapVoidExpression(expression) {
  let current = expression;
  while (current.kind === ts.SyntaxKind.VoidExpression) {
    current = current.expression;
  }
  return current;
}

function intervalCallbackSignature(callback, sourceFile) {
  if (ts.isIdentifier(callback)) return callback.text;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;

  let expression = null;
  if (ts.isBlock(callback.body)) {
    if (callback.body.statements.length !== 1) return null;
    const statement = callback.body.statements[0];
    if (!ts.isExpressionStatement(statement)) return null;
    expression = statement.expression;
  } else {
    expression = callback.body;
  }

  const directExpression = unwrapVoidExpression(expression);
  if (!ts.isCallExpression(directExpression) || !ts.isIdentifier(directExpression.expression)) {
    return null;
  }

  const args = directExpression.arguments
    .map((argument) => argument.getText(sourceFile).replace(/\s+/g, ''))
    .join(',');
  return `${directExpression.expression.text}(${args})`;
}

function namedIntervalScope(node, sourceFile) {
  let current = node.parent;

  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return {
        name: current.name.text,
        source: current.getText(sourceFile),
      };
    }

    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      current.parent.initializer === current &&
      ts.isIdentifier(current.parent.name)
    ) {
      return {
        name: current.parent.name.text,
        source: current.parent.getText(sourceFile),
      };
    }

    current = current.parent;
  }

  return {
    name: '<module>',
    source: sourceFile.getText(),
  };
}

function productionIntervals() {
  const intervals = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const { sourceFile } = parseSourceFile(absolutePath);

    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length >= 2 &&
        (
          node.expression.getText(sourceFile) === 'window.setInterval' ||
          node.expression.getText(sourceFile) === 'setInterval'
        )
      ) {
        const scope = namedIntervalScope(node, sourceFile);
        intervals.push({
          file: path.relative(FRONTEND_ROOT, absolutePath),
          signature: intervalCallbackSignature(node.arguments[0], sourceFile),
          delay: numericValue(node.arguments[1], sourceFile),
          scopeName: scope.name,
          scopeSource: scope.source,
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return intervals;
}

test('guest map click selects the exact real or fallback table from the click zone', () => {
  assert.equal(
    findClickZoneBinding(),
    'selectVisualTable',
    'Rendered ClickZone must stay wired to the guest table-selection action',
  );

  const { source } = findCallableSource('selectVisualTable');
  const visualReal = { number: 17, seats: 4 };
  const realTable = { id: 'db-17', tableNumber: 17, seats: 4 };
  const realCalls = runSelectVisualTableScenario(source, {
    visualTable: visualReal,
    realTable,
    fallbackTable: null,
  });

  assert.equal(realCalls.lookupNumber, 17);
  assert.equal(realCalls.fallbackArgs, null);
  assert.equal(realCalls.activeNumber, 17);
  assert.equal(realCalls.selectedTable, realTable);
  assert.deepEqual(realCalls.delays, [650]);

  const visualFallback = { number: 88, seats: 6 };
  const fallbackTable = { id: 'visual-88', tableNumber: 88, seats: 6 };
  const fallbackCalls = runSelectVisualTableScenario(source, {
    visualTable: visualFallback,
    realTable: undefined,
    fallbackTable,
  });

  assert.equal(fallbackCalls.lookupNumber, 88);
  assert.deepEqual(fallbackCalls.fallbackArgs, [88, 6]);
  assert.equal(fallbackCalls.activeNumber, 88);
  assert.equal(fallbackCalls.selectedTable, fallbackTable);
  assert.deepEqual(fallbackCalls.delays, [650]);
});

test('role buttons send their own mode through the real changeMode action', () => {
  const { source } = findCallableSource('changeMode', 'clearRoleSession(telegramAuth.isTelegram)');
  const roles = [
    ['Гість', 'guest'],
    ['Офіціант', 'waiter'],
    ['Кальянник', 'hookah'],
    ['Адмін', 'admin'],
    ['Директор', 'director'],
  ];

  for (const [label, expectedMode] of roles) {
    const { handlerSource } = findButtonHandler(label, 'changeMode');
    let requestedMode = null;
    compileHandler(handlerSource, {
      changeMode(nextMode) {
        requestedMode = nextMode;
      },
    })();
    assert.equal(requestedMode, expectedMode, `${label} must request ${expectedMode}`);

    let selectedMode = null;
    let hash = '#guest';
    let cleared = 0;
    const initialMode = expectedMode === 'guest' ? 'waiter' : 'guest';
    const changeMode = compileCallable('changeMode', source, {
      mode: initialMode,
      telegramAuth: { isTelegram: false },
      clearRoleSession() {
        cleared += 1;
      },
      window: {
        location: {
          get hash() {
            return hash;
          },
          set hash(value) {
            const next = String(value);
            hash = next.startsWith('#') ? next : `#${next}`;
          },
        },
      },
      setMode(nextMode) {
        selectedMode = nextMode;
      },
    });

    changeMode(requestedMode);
    assert.equal(selectedMode, expectedMode);
    assert.equal(hash, `#${expectedMode}`);
    assert.equal(cleared, 1);
  }
});

test('waiter Occupied and Free buttons call the real waiter-status endpoint with matching states', async () => {
  const { source } = findCallableSource('setStatus', 'tablesApi.waiterStatus');
  const selectedTable = { id: 'table-17', tableNumber: 17, status: 'free' };

  for (const [label, expectedStatus] of [
    ['Зайнятий', 'occupied'],
    ['Вільний', 'free'],
  ]) {
    const { handlerSource } = findButtonHandler(label, 'setStatus');
    let handlerArgs = null;
    compileHandler(handlerSource, {
      selectedTable,
      setStatus(table, status) {
        handlerArgs = [table, status];
      },
    })();
    assert.deepEqual(handlerArgs, [selectedTable, expectedStatus]);

    let apiArgs = null;
    let latestTables = [selectedTable];
    let silentReload = null;
    const setStatus = compileCallable('setStatus', source, {
      setBusy() {},
      setNotice() {},
      setError() {},
      tablesApi: {
        async waiterStatus(id, status) {
          apiArgs = [id, status];
          return { ...selectedTable, status };
        },
      },
      setTables(updater) {
        latestTables = updater(latestTables);
      },
      STATUS_LABELS: {
        free: 'Вільний',
        occupied: 'Зайнятий',
      },
      async load(silent) {
        silentReload = silent;
      },
    });

    await setStatus(selectedTable, expectedStatus);
    assert.deepEqual(apiArgs, [selectedTable.id, expectedStatus]);
    assert.equal(latestTables[0].status, expectedStatus);
    assert.equal(silentReload, true);
  }
});

test('guest service buttons create waiter and hookah calls only for the current booking', async () => {
  const booking = {
    bookingId: 'booking-own',
    bookingDate: '2026-08-27',
    bookingTime: '19:00',
    tableNumber: 17,
    status: 'approved',
  };

  const waiterButton = findButtonHandler('Офіціант', 'callWaiter');
  let waiterButtonCalled = 0;
  compileHandler(waiterButton.handlerSource, {
    callWaiter() {
      waiterButtonCalled += 1;
    },
  })();
  assert.equal(waiterButtonCalled, 1);

  const hookahButton = findButtonHandler('Кальянник', 'callHookahWorker');
  let hookahButtonCalled = 0;
  compileHandler(hookahButton.handlerSource, {
    callHookahWorker() {
      hookahButtonCalled += 1;
    },
  })();
  assert.equal(hookahButtonCalled, 1);

  const waiterSource = findCallableSource('callWaiter', 'waiterMutationVersion.current').source;
  let waiterBookingId = null;
  let waiterState = null;
  const waiterMutationVersion = { current: 0 };
  const callWaiter = compileCallable('callWaiter', waiterSource, {
    bookingIsToday: true,
    waiterStatus: { canCall: true, activeCall: null },
    showBurst() {},
    waiterMutationVersion,
    setWaiterCalling() {},
    setWaiterError() {},
    setWaiterMessage() {},
    waiterCallsApi: {
      async createFromGuest(bookingId) {
        waiterBookingId = bookingId;
        return {
          message: 'ok',
          call: {
            id: 'waiter-call',
            tableNumber: 17,
            waiterId: 'waiter-1',
            waiterName: 'Офіціант',
          },
        };
      },
    },
    booking,
    setWaiterStatus(updater) {
      waiterState = updater({
        canCall: true,
        activeCall: null,
        bookingStatus: booking.status,
        tableStatus: 'occupied',
      });
    },
    errorText(error) {
      return String(error);
    },
  });

  await callWaiter();
  assert.equal(waiterBookingId, booking.bookingId);
  assert.equal(waiterState.activeCall.id, 'waiter-call');
  assert.equal(waiterMutationVersion.current, 2);

  const hookahSource = findCallableSource('callHookahWorker', 'hookahMutationVersion.current').source;
  let hookahBookingId = null;
  let hookahState = null;
  const hookahMutationVersion = { current: 0 };
  const callHookahWorker = compileCallable('callHookahWorker', hookahSource, {
    bookingIsToday: true,
    hookahStatus: {
      canCall: true,
      activeCall: null,
      hookahCallsAvailable: true,
    },
    showBurst() {},
    hookahMutationVersion,
    setHookahCalling() {},
    setHookahError() {},
    setHookahMessage() {},
    hookahCallsApi: {
      async createFromGuest(bookingId) {
        hookahBookingId = bookingId;
        return {
          message: 'ok',
          call: {
            id: 'hookah-call',
            tableNumber: 17,
            zoneName: 'Зал',
          },
        };
      },
    },
    booking,
    setHookahStatus(updater) {
      hookahState = updater({
        canCall: true,
        activeCall: null,
        hookahCallsAvailable: true,
        bookingStatus: booking.status,
        tableStatus: 'occupied',
      });
    },
    errorText(error) {
      return String(error);
    },
  });

  await callHookahWorker();
  assert.equal(hookahBookingId, booking.bookingId);
  assert.equal(hookahState.activeCall.id, 'hookah-call');
  assert.equal(hookahMutationVersion.current, 2);
});

test('each protected recurring production poller remains exactly 15 seconds', () => {
  const intervals = productionIntervals();
  const protectedPollers = [
    { label: 'Guest public settings', signature: 'refreshPublicSettings' },
    { label: 'Guest booking status', signature: 'refreshBookingStatus' },
    { label: 'Guest waiter status', signature: 'loadWaiterStatus(true)' },
    { label: 'Guest hookah service status', signature: 'loadHookahStatus(true)' },
    { label: 'Guest hookah panel status', signature: 'loadStatus(true)' },
    {
      label: 'Guest booking decision',
      signature: 'load()',
      markers: ['bookingsApi.guestList'],
    },
    {
      label: 'Waiter dashboard',
      signature: 'load()',
      markers: ['bookingsApi.getToday()', 'waiterCallsApi.list()'],
    },
    {
      label: 'Waiter tables',
      signature: 'load(true)',
      markers: ['tablesApi.getAll()'],
    },
    {
      label: 'Admin attention',
      signature: 'load(true)',
      markers: ['adminAttentionApi.get()'],
    },
    {
      label: 'Admin tables',
      signature: 'load(true)',
      markers: ['mapApi.get()', 'bookingsApi.tableStatuses', 'setFullMap(mapResult.value)'],
    },
    {
      label: 'Director dashboard',
      signature: 'load(true)',
      markers: ['analyticsApi.today()', 'analyticsApi.hourlyLoad(selectedDate)'],
    },
    { label: 'Waiter call alerts', signature: 'checkCalls()' },
    { label: 'Hookah calls', signature: 'loadCalls(true)' },
    { label: 'Compact admin', signature: 'loadAll(true)' },
    { label: 'Site photo mode', signature: 'refreshMode' },
  ];

  for (const poller of protectedPollers) {
    const markers = poller.markers || [];
    const matches = intervals.filter(
      (interval) =>
        interval.signature === poller.signature &&
        markers.every((marker) => interval.scopeSource.includes(marker)),
    );

    assert.equal(
      matches.length,
      1,
      `${poller.label} protected poller must resolve to exactly one live call site, found ${matches.length}`,
    );

    const [interval] = matches;
    assert.equal(
      interval.delay,
      15_000,
      `${poller.label} poll in ${interval.scopeName} (${interval.file}) must stay exactly 15 seconds`,
    );
  }
});
