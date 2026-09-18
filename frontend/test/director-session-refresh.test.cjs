const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadStaffApi(clientMock) {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/api/staff.ts'),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const loadDependency = (specifier) => {
    assert.equal(specifier, './client');
    return clientMock;
  };

  new Function('require', 'module', 'exports', compiled)(
    loadDependency,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports.staffApi;
}

test('changing Director credentials keeps the current phone signed in with the renewed token', async () => {
  const payload = {
    fullName: 'Новий Директор',
    loginName: 'new-director',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  };
  const response = {
    fullName: payload.fullName,
    loginName: payload.loginName,
    configured: true,
    accessToken: 'renewed-director-token',
  };
  const savedTokens = [];
  const staffApi = loadStaffApi({
    api: {
      patch: async (url, body) => {
        assert.equal(url, '/staff/director-access');
        assert.deepEqual(body, payload);
        return response;
      },
    },
    setAccessToken: (token) => savedTokens.push(token),
  });

  const result = await staffApi.updateDirectorAccess(payload);

  assert.deepEqual(result, response);
  assert.deepEqual(savedTokens, ['renewed-director-token']);
});

test('an invalidated Director session returns the old phone to sign-in', () => {
  const clientSource = fs.readFileSync(
    path.resolve(__dirname, '../src/api/client.ts'),
    'utf8',
  );
  const gateSource = fs.readFileSync(
    path.resolve(__dirname, '../src/director/DirectorAuthGate.tsx'),
    'utf8',
  );

  assert.match(
    clientSource,
    /res\.status === 401[\s\S]*Недійсний токен авторизації[\s\S]*AUTH_SESSION_INVALIDATED_EVENT/,
  );
  assert.match(
    gateSource,
    /addEventListener\([\s\S]*AUTH_SESSION_INVALIDATED_EVENT,[\s\S]*handleInvalidatedSession/,
  );
  assert.match(gateSource, /Сеанс завершено\. Увійдіть знову\./);
});
