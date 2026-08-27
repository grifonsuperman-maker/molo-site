const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(FRONTEND_ROOT, 'src', 'guest');
const FUNCTION_NAMES = ['getRestaurantFromResponse', 'getMapFromResponse'];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function parseSourceFile(absolutePath) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  return ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function functionsNamed(sourceFile, name) {
  const matches = [];

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      matches.push(node.getText(sourceFile).replace(/^export\s+/, ''));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

function loadApiResponseHelpers() {
  const matchesByName = new Map(FUNCTION_NAMES.map((name) => [name, []]));

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const sourceFile = parseSourceFile(absolutePath);

    for (const name of FUNCTION_NAMES) {
      for (const source of functionsNamed(sourceFile, name)) {
        matchesByName.get(name).push({ absolutePath, source });
      }
    }
  }

  for (const name of FUNCTION_NAMES) {
    const matches = matchesByName.get(name);
    const locations = matches.map(({ absolutePath }) => path.relative(FRONTEND_ROOT, absolutePath));
    assert.equal(
      matches.length,
      1,
      `Expected ${name} in exactly one guest production file, found ${matches.length}: ${locations.join(', ')}`,
    );
  }

  const source = FUNCTION_NAMES.map((name) => matchesByName.get(name)[0].source).join('\n');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText;

  return new Function(`${javascript}\nreturn { getRestaurantFromResponse, getMapFromResponse };`)();
}

test('guest API response helpers keep direct, wrapped and invalid response behavior', () => {
  const { getRestaurantFromResponse, getMapFromResponse } = loadApiResponseHelpers();

  const restaurant = { id: 'restaurant-1', name: 'MOLO' };
  const map = { restaurant, zones: [], tables: [], objects: [] };

  assert.equal(getRestaurantFromResponse(restaurant), restaurant);
  assert.equal(getRestaurantFromResponse({ data: restaurant }), restaurant);
  assert.equal(getRestaurantFromResponse(null), null);
  assert.equal(getRestaurantFromResponse('invalid'), null);

  assert.equal(getMapFromResponse(map), map);
  assert.equal(getMapFromResponse({ data: map }), map);
  assert.equal(getMapFromResponse(null), null);
  assert.equal(getMapFromResponse('invalid'), null);
});
