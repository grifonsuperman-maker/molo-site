const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

const apiSource = read('frontend/src/api/logs.ts');
const controlsSource = read('frontend/src/director/DirectorStaffActionsArchiveControls.tsx');
const dockSource = read('frontend/src/director/DirectorStaffActionsArchiveDock.tsx');
const workspaceSource = read('frontend/src/director/DirectorWorkspace.tsx');
const panelSource = read('frontend/src/director/PremiumDirectorPanel.tsx');
const controllerSource = read('backend/src/logs/logs.controller.ts');

test('Director staff-action working feed reads the latest 300 active logs in one request', () => {
  assert.match(apiSource, /getLogPage\('\/logs\/active', \{ page: 1, limit: 300 \}\)/);
  assert.doesNotMatch(apiSource, /for \(let page = 1; page <= 3;/);
  assert.match(apiSource, /getAll: getRecentActiveLogs/);
  assert.match(apiSource, /getActive:/);
  assert.match(apiSource, /getArchive:/);
  assert.match(controllerSource, /findActive\([\s\S]*positiveInteger\(limit, 50, 300\)/);
  assert.match(controllerSource, /findArchive\([\s\S]*positiveInteger\(limit, 50, 100\)/);
});

test('staff-action archive UI exposes archive and permanent delete without restore', () => {
  assert.match(controlsSource, /const LOG_PAGE_SIZE = 50;/);
  assert.match(controlsSource, /Активні/);
  assert.match(controlsSource, /Архів/);
  assert.match(controlsSource, /Архівувати/);
  assert.match(controlsSource, /Видалити назавжди/);
  assert.doesNotMatch(controlsSource, /Відновити/);
  assert.doesNotMatch(controlsSource, /logsApi\.restore/);
  assert.match(apiSource, /\/logs\/\$\{encodeURIComponent\(id\)\}\/archive/);
  assert.match(apiSource, /deletePermanently/);
});

test('successful mutations remove stale cards before reconciliation and failed silent refresh stays retryable', () => {
  const archiveRemoval = controlsSource.indexOf('setActiveLogs((current) => current.filter((item) => item.id !== log.id));');
  const archiveChanged = controlsSource.indexOf('await onChanged();', archiveRemoval);
  const archiveRefresh = controlsSource.indexOf('await loadActivePage(1, false, false);', archiveChanged);
  assert.ok(archiveRemoval >= 0 && archiveRemoval < archiveChanged && archiveChanged < archiveRefresh);

  const deleteRemoval = controlsSource.indexOf('setArchivedLogs((current) => current.filter((item) => item.id !== log.id));');
  const deleteChanged = controlsSource.indexOf('await onChanged();', deleteRemoval);
  const deleteRefresh = controlsSource.indexOf('await loadArchivePage(1, false, false);', deleteChanged);
  assert.ok(deleteRemoval >= 0 && deleteRemoval < deleteChanged && deleteChanged < deleteRefresh);

  assert.match(controlsSource, /setActivePage\(0\);[\s\S]*setActiveHasMore\(false\);[\s\S]*setActiveRefreshRetry\(!showLoading\);/);
  assert.match(controlsSource, /setArchivePage\(0\);[\s\S]*setArchiveHasMore\(false\);[\s\S]*setArchiveRefreshRetry\(!showLoading\);/);
  assert.match(controlsSource, /activeRefreshRetry[\s\S]*Спробувати ще/);
  assert.match(controlsSource, /archiveRefreshRetry[\s\S]*Спробувати ще/);
});

test('permanent delete is presented only from archive with a separate confirmation', () => {
  assert.match(controlsSource, /view === 'active'[\s\S]*archiveLog\(log\)[\s\S]*requestPermanentDelete\(log\)/);
  assert.match(controlsSource, /deleteTarget \? createPortal/);
  assert.match(controlsSource, /Видалити дію персоналу назавжди\?/);
  assert.match(controlsSource, /Історію бронювань це не змінює\./);
  assert.match(controlsSource, /deleteError/);
});

test('archive manager is connected to the live Director staff-actions section', () => {
  assert.match(workspaceSource, /DirectorStaffActionsArchiveDock/);
  assert.match(dockSource, /textContent\?\.trim\(\) === 'Дії персоналу'/);
  assert.match(dockSource, /heading\?\.closest\('section'\)/);
  assert.match(dockSource, /button\[aria-label="Оновити"\]/);
});

test('Director polling remains exactly 15 seconds', () => {
  assert.match(panelSource, /window\.setInterval\(\(\) => void load\(true\), 15_000\)/);
});
