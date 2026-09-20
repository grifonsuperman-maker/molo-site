import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GuestInstallPrompt from './guest/components/GuestInstallPrompt';
import GuestPushOptIn from './guest/components/GuestPushOptIn';
import './styles.css';
import './guest/no-show-rule.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><GuestInstallPrompt /><GuestPushOptIn /></React.StrictMode>);
