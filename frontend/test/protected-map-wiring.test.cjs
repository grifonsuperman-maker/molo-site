const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const GUEST_ROOT = path.join(FRONTEND_ROOT, 'src', 'guest');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function parseSources() {
  return sourceFiles(GUEST_ROOT).map((absolutePath) => {
    const source = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
    return {
      absolutePath,
      source,
      sourceFile: ts.createSourceFile(
        absolutePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    };
  });
}

function collectNamedDeclarations(parsedSources) {
  const declarations = new Map();

  function add(name, node, sourceFile, absolutePath) {
    const current = declarations.get(name) || [];
    current.push({ node, sourceFile, absolutePath });
    declarations.set(name, current);
  }

  for (const parsed of parsedSources) {
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        add(node.name.text, node, parsed.sourceFile, parsed.absolutePath);
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        add(node.name.text, node, parsed.sourceFile, parsed.absolutePath);
      }

      ts.forEachChild(node, visit);
    }

    visit(parsed.sourceFile);
  }

  return declarations;
}

function declarationBody(declaration) {
  if (ts.isVariableDeclaration(declaration.node)) return declaration.node.initializer || null;
  if (ts.isFunctionDeclaration(declaration.node)) return declaration.node.body || null;
  return null;
}

function dependsOnIdentifier(node, sourceFile, targetName, declarations, seen = new Set()) {
  if (!node) return false;
  let found = false;

  function visit(current) {
    if (found) return;

    if (ts.isIdentifier(current)) {
      if (current.text === targetName) {
        found = true;
        return;
      }

      const candidates = declarations.get(current.text) || [];
      if (candidates.length === 1) {
        const candidate = candidates[0];
        const key = `${candidate.absolutePath}:${candidate.node.pos}:${current.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          const body = declarationBody(candidate);
          if (
            body &&
            dependsOnIdentifier(body, candidate.sourceFile, targetName, declarations, seen)
          ) {
            found = true;
            return;
          }
        }
      }
    }

    ts.forEachChild(current, visit);
  }

  visit(node);
  return found;
}

function findUniqueVariable(name, declarations) {
  const matches = (declarations.get(name) || []).filter(({ node }) =>
    ts.isVariableDeclaration(node),
  );

  assert.equal(
    matches.length,
    1,
    `Expected exactly one protected guest variable ${name}, found ${matches.length}`,
  );
  return matches[0];
}

function isInsideRenderedJsx(node) {
  let current = node.parent;

  while (current) {
    if (ts.isJsxAttribute(current) || ts.isJsxExpression(current)) return true;
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      return false;
    }
    current = current.parent;
  }

  return false;
}

test('protected guest LOCATIONS stays bound to the rendered currentLocation map', () => {
  const parsedSources = parseSources();
  const declarations = collectNamedDeclarations(parsedSources);
  const locations = findUniqueVariable('LOCATIONS', declarations);
  const currentLocation = findUniqueVariable('currentLocation', declarations);

  assert.ok(
    locations.node.initializer && ts.isArrayLiteralExpression(locations.node.initializer),
    'Protected LOCATIONS must remain the concrete guest map definition',
  );
  assert.ok(
    dependsOnIdentifier(
      currentLocation.node.initializer,
      currentLocation.sourceFile,
      'LOCATIONS',
      declarations,
    ),
    'Rendered currentLocation must stay derived from the protected LOCATIONS definition',
  );
  assert.ok(
    dependsOnIdentifier(
      currentLocation.node.initializer,
      currentLocation.sourceFile,
      'selectedLocationKey',
      declarations,
    ),
    'Rendered currentLocation must keep following the guest location selection',
  );

  const renderedProperties = new Set();

  for (const parsed of parsedSources) {
    function visit(node) {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'currentLocation' &&
        isInsideRenderedJsx(node)
      ) {
        renderedProperties.add(node.name.text);
      }

      ts.forEachChild(node, visit);
    }

    visit(parsed.sourceFile);
  }

  for (const property of ['background', 'label', 'width', 'height', 'tables']) {
    assert.ok(
      renderedProperties.has(property),
      `Rendered guest map must keep using currentLocation.${property}`,
    );
  }
});
