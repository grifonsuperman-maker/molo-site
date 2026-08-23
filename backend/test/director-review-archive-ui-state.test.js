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
    /if \(!append && showLoading\) \{[\s\S]*setActiveReviews\(\[\]\);[\s\S]*setActiveResultTotal\(0\);[\s\S]*setActivePage\(0\);[\s\S]*setActiveHasMore\(false\);/,
  );
  assert.match(
    archiveLoader,
    /if \(!append && showLoading\) \{[\s\S]*setArchivedReviews\(\[\]\);[\s\S]*setArchiveResultTotal\(0\);[\s\S]*setArchivePage\(0\);[\s\S]*setArchiveHasMore\(false\);/,
  );
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
    'async function loadMoreActive(',
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
