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

function loadDurationFormatter() {
  const matches = [];

  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const sourceFile = parseSourceFile(absolutePath);
    const formatters = functionsNamed(sourceFile, 'formatDuration');
    if (formatters.length > 0) {
      matches.push({ absolutePath, sourceFile, formatters });
    }
  }

  assert.equal(matches.length, 1, `Expected formatDuration in exactly one production file, found ${matches.length}`);

  const [{ sourceFile, formatters }] = matches;
  assert.equal(formatters.length, 1, `Expected exactly one formatDuration function in its production file, found ${formatters.length}`);

  const hourWords = functionsNamed(sourceFile, 'hourWord');
  assert.equal(hourWords.length, 1, `Expected exactly one hourWord beside formatDuration, found ${hourWords.length}`);

  const source = `${hourWords[0]}\n${formatters[0]}`;
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
