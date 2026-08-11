import { resolveTelegramMode } from './telegramRuntime.js';

function expectEqual(actual: unknown, expected: unknown, name: string) {
  if (actual !== expected) {
    throw new Error(
      `${name}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

expectEqual(resolveTelegramMode('guest', ''), 'guest', 'guest route');
expectEqual(resolveTelegramMode('waiter', ''), 'waiter', 'waiter route');
expectEqual(resolveTelegramMode('hookah', '#guest'), 'hookah', 'hookah route');
expectEqual(resolveTelegramMode('admin', ''), 'admin', 'admin route');
expectEqual(resolveTelegramMode('owner', ''), 'director', 'director route');
expectEqual(resolveTelegramMode('waiter', '#admin'), null, 'explicit route');

console.log('telegramRuntime tests passed');
