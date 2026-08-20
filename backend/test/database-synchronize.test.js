const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
  assertProductionDatabaseSynchronize,
  resolveDatabaseSynchronize,
} = require('../dist/database/database-synchronize.js');

test('database synchronize stays enabled only when DB_SYNCHRONIZE is unset', () => {
  assert.equal(resolveDatabaseSynchronize(undefined), true);
});

test('database synchronize can be explicitly disabled for an isolated database', () => {
  assert.equal(resolveDatabaseSynchronize('false'), false);
  assert.equal(resolveDatabaseSynchronize(' FALSE '), false);
});

test('database synchronize can be explicitly enabled', () => {
  assert.equal(resolveDatabaseSynchronize('true'), true);
  assert.equal(resolveDatabaseSynchronize(' TRUE '), true);
});

test('database synchronize rejects empty and ambiguous configured values', () => {
  for (const value of ['', '   ', '0', 'off']) {
    assert.throws(
      () => resolveDatabaseSynchronize(value),
      /DB_SYNCHRONIZE must be "true" or "false"/,
    );
  }
});

test('non-production runtime keeps existing synchronize configuration behavior', () => {
  assert.doesNotThrow(() =>
    assertProductionDatabaseSynchronize({ NODE_ENV: 'development' }),
  );
  assert.doesNotThrow(() =>
    assertProductionDatabaseSynchronize({
      NODE_ENV: 'development',
      DB_SYNCHRONIZE: 'true',
    }),
  );
});

test('production and Render require DB_SYNCHRONIZE=false explicitly', () => {
  for (const productionEnv of [
    { NODE_ENV: 'production' },
    { RENDER_EXTERNAL_URL: 'https://molo-backend.example' },
  ]) {
    assert.throws(
      () => assertProductionDatabaseSynchronize(productionEnv),
      /DB_SYNCHRONIZE must be "false" in production/,
    );
    assert.throws(
      () =>
        assertProductionDatabaseSynchronize({
          ...productionEnv,
          DB_SYNCHRONIZE: 'true',
        }),
      /DB_SYNCHRONIZE must be "false" in production/,
    );
  }
});

test('production accepts explicit DB_SYNCHRONIZE=false', () => {
  assert.doesNotThrow(() =>
    assertProductionDatabaseSynchronize({
      NODE_ENV: 'production',
      DB_SYNCHRONIZE: 'false',
    }),
  );
  assert.doesNotThrow(() =>
    assertProductionDatabaseSynchronize({
      RENDER_EXTERNAL_URL: 'https://molo-backend.example',
      DB_SYNCHRONIZE: ' FALSE ',
    }),
  );
});

test('TypeORM resolves DB_SYNCHRONIZE through ConfigService after config loading', async () => {
  const appModule = await readFile(
    path.resolve(__dirname, '../src/app.module.ts'),
    'utf8',
  );

  assert.ok(
    appModule.indexOf('ConfigModule.forRoot') <
      appModule.indexOf('TypeOrmModule.forRootAsync'),
  );
  assert.match(appModule, /TypeOrmModule\.forRootAsync\(\{/);
  assert.match(
    appModule,
    /configService\.get<string>\('DB_SYNCHRONIZE'\)/,
  );
  assert.doesNotMatch(appModule, /process\.env\.DB_SYNCHRONIZE/);

  const synchronizeUsages = appModule.match(
    /synchronize:\s*databaseSynchronize/g,
  );
  assert.equal(synchronizeUsages?.length, 2);
  assert.doesNotMatch(appModule, /synchronize:\s*false/);
});

test('production synchronize guard runs before Nest application startup', async () => {
  const main = await readFile(path.resolve(__dirname, '../src/main.ts'), 'utf8');

  assert.match(
    main,
    /import \{ assertProductionDatabaseSynchronize \} from '\.\/database\/database-synchronize';/,
  );
  assert.ok(
    main.indexOf('assertProductionDatabaseSynchronize();') <
      main.indexOf('NestFactory.create(AppModule)'),
  );
});
