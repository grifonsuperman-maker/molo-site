const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const controlsSource = fs.readFileSync(
  path.join(
    __dirname,
    '../../frontend/src/director/DirectorReviewArchiveControls.tsx',
  ),
  'utf8',
);

function sourceSection(startMarker, endMarker) {
  const start = controlsSource.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);

  const end = controlsSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);

  return controlsSource.slice(start, end);
}

function assertOrdered(section, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = section.indexOf(marker);
    assert.notEqual(current, -1, `Missing source marker: ${marker}`);
    assert.ok(
      current > previous,
      `Expected ${marker} after the previous reconciliation step`,
    );
    previous = current;
  }
}

test('failed review searches cannot reveal cards from the previous query', () => {
  const activeLoader = sourceSection(
    'async function loadActivePage(',
    'async function loadArchivePage(',
  );
  const archiveLoader = sourceSection(
    'async function loadArchivePage(',
    'useEffect(() => {',
  );

  assert.match(
    activeLoader,
    /if \(!append\) \{[\s\S]*if \(showLoading\) \{[\s\S]*setActiveReviews\(\[\]\);[\s\S]*setActiveResultTotal\(0\);[\s\S]*\}[\s\S]*setActivePage\(0\);[\s\S]*setActiveHasMore\(false\);[\s\S]*setActiveRefreshRetry\(!showLoading\);/,
  );
  assert.match(
    archiveLoader,
    /if \(!append\) \{[\s\S]*if \(showLoading\) \{[\s\S]*setArchivedReviews\(\[\]\);[\s\S]*setArchiveResultTotal\(0\);[\s\S]*\}[\s\S]*setArchivePage\(0\);[\s\S]*setArchiveHasMore\(false\);[\s\S]*setArchiveRefreshRetry\(!showLoading\);/,
  );
});

test('failed mutation refresh invalidates stale pagination and enables retry', () => {
  const activeLoader = sourceSection(
    'async function loadActivePage(',
    'async function loadArchivePage(',
  );
  const archiveLoader = sourceSection(
    'async function loadArchivePage(',
    'useEffect(() => {',
  );

  assert.ok(activeLoader.includes(`if (!append) {
          if (showLoading) {
            setActiveReviews([]);
            setActiveResultTotal(0);
          }
          setActivePage(0);
          setActiveHasMore(false);
          setActiveRefreshRetry(!showLoading);
        }`));
  assert.ok(archiveLoader.includes(`if (!append) {
          if (showLoading) {
            setArchivedReviews([]);
            setArchiveResultTotal(0);
          }
          setArchivePage(0);
          setArchiveHasMore(false);
          setArchiveRefreshRetry(!showLoading);
        }`));

  assert.ok(activeLoader.includes('setActiveRefreshRetry(false);'));
  assert.ok(archiveLoader.includes('setArchiveRefreshRetry(false);'));
});

test('failed mutation refresh can retry page one before loading more', () => {
  const activeRetry = sourceSection(
    'async function retryActiveRefresh(',
    'async function retryArchiveRefresh(',
  );
  const archiveRetry = sourceSection(
    'async function retryArchiveRefresh(',
    'async function loadMoreActive(',
  );
  const managerDialog = sourceSection(
    'const managerDialog = open ? createPortal(',
    'const deleteDialog = deleteTarget ? createPortal(',
  );

  assertOrdered(activeRetry, [
    "setBusy('active-retry');",
    'await loadActivePage(1, query, false, false);',
    'setBusy(null);',
  ]);
  assertOrdered(archiveRetry, [
    "setBusy('archive-retry');",
    'await loadArchivePage(1, query, false, false);',
    'setBusy(null);',
  ]);
  assert.ok(managerDialog.includes("view === 'active' && activeRefreshRetry"));
  assert.ok(managerDialog.includes("view === 'archive' && archiveRefreshRetry"));
  assert.ok(managerDialog.includes("!activeRefreshRetry && activeHasMore"));
  assert.ok(managerDialog.includes("!archiveRefreshRetry && archiveHasMore"));
  assert.ok(managerDialog.includes("onClick={() => void retryActiveRefresh()}"));
  assert.ok(managerDialog.includes("onClick={() => void retryArchiveRefresh()}"));
  assert.ok(managerDialog.includes("'Спробувати ще'"));
});

test('successful review mutations reconcile the visible list before refresh', () => {
  const archiveMutation = sourceSection(
    'async function archiveReview(',
    'async function restoreReview(',
  );
  assertOrdered(archiveMutation, [
    'await reviewsApi.archive(review.id);',
    'setActiveReviews((current) => current.filter((item) => item.id !== review.id));',
    'setActiveResultTotal((current) => Math.max(0, current - 1));',
    'await onChanged();',
    'await loadActivePage(1, query, false, false);',
  ]);

  const restoreMutation = sourceSection(
    'async function restoreReview(',
    'async function deleteReviewPermanently(',
  );
  assertOrdered(restoreMutation, [
    'await reviewsApi.restore(review.id);',
    'setArchivedReviews((current) => current.filter((item) => item.id !== review.id));',
    'setArchiveResultTotal((current) => Math.max(0, current - 1));',
    'await onChanged();',
    'await loadArchivePage(1, query, false, false);',
  ]);

  const deleteMutation = sourceSection(
    'async function deleteReviewPermanently(',
    'async function retryActiveRefresh(',
  );
  assertOrdered(deleteMutation, [
    'await reviewsApi.deletePermanently(review.id);',
    'setArchivedReviews((current) => current.filter((item) => item.id !== review.id));',
    'setArchiveResultTotal((current) => Math.max(0, current - 1));',
    'setDeleteTarget(null);',
    'await onChanged();',
    'await loadArchivePage(1, query, false, false);',
  ]);
});