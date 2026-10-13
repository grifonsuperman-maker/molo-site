import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GuestInstallPrompt from './guest/components/GuestInstallPrompt';
import GuestPushOptIn from './guest/components/GuestPushOptIn';
import './styles.css';
import './guest/no-show-rule.css';
import { isDeveloperConsoleEntry } from './entryRoute';

const DeveloperWorkspace = React.lazy(() => import('./developer/DeveloperWorkspace'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDeveloperConsoleEntry ? (
      <React.Suspense fallback={<main className="min-h-screen bg-[#10100f] p-8 text-white">Завантаження…</main>}>
        <DeveloperWorkspace />
      </React.Suspense>
    ) : <><App /><GuestInstallPrompt /><GuestPushOptIn /></>}
  </React.StrictMode>,
);
