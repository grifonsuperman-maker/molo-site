// Synthetic transport tests supply fixtures, never a real Syrve endpoint.
// Production always injects the durable PostgreSQL limiter through Nest.
const { performance } = require('node:perf_hooks');
const { SyrveRequestGuardError } = require('../../dist/syrve/syrve-request-limiter.js');
module.exports = {
  acquire: async (_, controls = {}) => {
    try { await controls.beforeClaim?.(); }
    catch (error) { throw new SyrveRequestGuardError(error); }
    return { expiresAt: performance.now() + 1_000 };
  },
  cooldown: async () => {},
};
