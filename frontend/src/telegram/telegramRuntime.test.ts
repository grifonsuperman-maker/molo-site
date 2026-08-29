import { expandTelegramWebApp, resolveTelegramMode } from './telegramRuntime.js';

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

let iosExpandCalls = 0;
let iosFullscreenCalls = 0;
expandTelegramWebApp({
  platform: 'ios',
  expand: () => {
    iosExpandCalls += 1;
  },
  requestFullscreen: () => {
    iosFullscreenCalls += 1;
  },
});
expectEqual(iosExpandCalls, 1, 'iOS keeps expand fallback');
expectEqual(iosFullscreenCalls, 1, 'iOS requests fullscreen');

let androidExpandCalls = 0;
let androidFullscreenCalls = 0;
expandTelegramWebApp({
  platform: 'android',
  expand: () => {
    androidExpandCalls += 1;
  },
  requestFullscreen: () => {
    androidFullscreenCalls += 1;
  },
});
expectEqual(androidExpandCalls, 1, 'Android keeps existing expand behavior');
expectEqual(androidFullscreenCalls, 0, 'Android does not change fullscreen behavior');

let fallbackExpandCalls = 0;
expandTelegramWebApp({
  platform: 'ios',
  expand: () => {
    fallbackExpandCalls += 1;
  },
  requestFullscreen: () => {
    throw new Error('UNSUPPORTED');
  },
});
expectEqual(fallbackExpandCalls, 1, 'unsupported iOS keeps expanded mode');

console.log('telegramRuntime tests passed');
