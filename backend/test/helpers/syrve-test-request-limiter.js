// Synthetic transport tests supply fixtures, never a real Syrve endpoint.
// Production always injects the durable PostgreSQL limiter through Nest.
const { performance } = require('node:perf_hooks');
module.exports = {
  acquire: async () => ({ expiresAt: performance.now() + 1_000 }),
  cooldown: async () => {},
};
