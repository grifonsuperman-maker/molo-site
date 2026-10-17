import { isDeveloperConsolePath } from './developer/developerConsoleRoute';

// Capture the entry route before any optional external SDK executes. Both the
// loader and React use this same decision, even if the URL changes during load.
export const isDeveloperConsoleEntry = isDeveloperConsolePath(window.location.pathname);
