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

function findFunctionSource(name) {
  const matches = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      absolutePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        matches.push(node.getText(sourceFile));
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.equal(matches.length, 1, `Expected exactly one ${name} production function, found ${matches.length}`);
  return matches[0];
}

function loadDurationFormatter() {
  const source = `${findFunctionSource('hourWord')}\n${findFunctionSource('formatDuration')}`;
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText;

  return new Function(`${javascript}\nreturn formatDuration;`)();
}

test('guest duration labels keep the current Ukrainian wording', () => {
  const formatDuration = loadDurationFormatter();
  const cases = [
    [30, '30 хв'],
    [59, '59 хв'],
    [60, '1 година'],
    [90, '1,5 години'],
    [120, '2 години'],
    [180, '3 години'],
    [240, '4 години'],
    [300, '5 годин'],
  ];

  for (const [minutes, expected] of cases) {
    assert.equal(formatDuration(minutes), expected, `Unexpected label for ${minutes} minutes`);
  }
});
