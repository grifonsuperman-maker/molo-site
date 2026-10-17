import { isDeveloperConsoleEntry } from './entryRoute';

function loadTelegramSdk(): Promise<void> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js?59';
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

async function bootstrapApplication() {
  if (!isDeveloperConsoleEntry) await loadTelegramSdk();
  // Import after SDK readiness so the existing Telegram startup sees WebApp.
  // The developer entry never inserts, fetches or waits for that SDK.
  await import('./main');
}

void bootstrapApplication().catch(() => {
  const root = document.getElementById('root');
  if (root) root.textContent = 'Не вдалося завантажити застосунок. Оновіть сторінку.';
});
