const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCorsOptions,
  resolveProductionCorsOrigins,
} = require('../dist/config/cors.js');

function checkOrigin(options, origin) {
  return new Promise((resolve) => {
    options.origin(origin, (error, allow) => resolve({ error, allow }));
  });
}

test('development keeps permissive CORS for local work', () => {
  const options = buildCorsOptions({ NODE_ENV: 'development' });

  assert.equal(options.origin, true);
  assert.equal(options.credentials, true);
});

test('production requires an explicit browser origin source', () => {
  assert.throws(
    () => buildCorsOptions({ RENDER_EXTERNAL_URL: 'https://backend.example' }),
    /CORS_ALLOWED_ORIGINS or TELEGRAM_WEB_APP_URL is required in production/,
  );
});

test('production combines configured origins with Telegram Web App origin', () => {
  const origins = resolveProductionCorsOrigins({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS:
      'https://molo.example, https://staff.example/some-path',
    TELEGRAM_WEB_APP_URL: 'https://molo.example/#guest',
  });

  assert.deepEqual(origins, [
    'https://molo.example',
    'https://staff.example',
  ]);
});

test('production allows only configured browser origins and non-browser requests', async () => {
  const options = buildCorsOptions({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://molo.example,https://staff.example',
  });

  assert.deepEqual(await checkOrigin(options, 'https://molo.example'), {
    error: null,
    allow: true,
  });
  assert.deepEqual(await checkOrigin(options, undefined), {
    error: null,
    allow: true,
  });

  const denied = await checkOrigin(options, 'https://attacker.example');
  assert.equal(denied.allow, false);
  assert.match(denied.error.message, /CORS origin is not allowed/);
});

test('production rejects wildcard or malformed origin configuration', () => {
  assert.throws(
    () =>
      buildCorsOptions({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: '*',
      }),
    /Invalid CORS_ALLOWED_ORIGINS origin/,
  );
});
