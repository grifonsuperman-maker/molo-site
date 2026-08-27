const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(FRONTEND_ROOT, 'src');
const FUNCTION_NAMES = ['timeToMinutes', 'minutesToTime', 'addMinutesToTime'];

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

function loadTimeMath() {
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
      `Expected ${name} in exactly one production file, found ${matches.length}: ${locations.join(', ')}`,
    );
  }

  const locations = new Set(FUNCTION_NAMES.map((name) => matchesByName.get(name)[0].absolutePath));
  assert.equal(locations.size, 1, 'Expected guest time helpers to live together in one production file');

  const source = FUNCTION_NAMES.map((name) => matchesByName.get(name)[0].source).join('\n');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText;

  return new Function(`${javascript}\nreturn { timeToMinutes, minutesToTime, addMinutesToTime };`)();
}

test('guest time calculations keep the current booking behavior', () => {
  const { timeToMinutes, minutesToTime, addMinutesToTime } = loadTimeMath();

  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('19:30'), 1170);
  assert.equal(timeToMinutes('23:59'), 1439);

  assert.equal(minutesToTime(0), '00:00');
  assert.equal(minutesToTime(1170), '19:30');
  assert.equal(minutesToTime(1439), '23:59');
  assert.equal(minutesToTime(1440), '00:00');
  assert.equal(minutesToTime(1500), '01:00');
  assert.equal(minutesToTime(-30), '23:30');

  assert.equal(addMinutesToTime('19:00', 120), '21:00');
  assert.equal(addMinutesToTime('23:30', 90), '01:00');
  assert.equal(addMinutesToTime('00:15', -30), '23:45');
});
