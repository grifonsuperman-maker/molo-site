const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const panelSource = fs.readFileSync(
  path.join(
    __dirname,
    '../../frontend/src/director/PremiumDirectorPanel.tsx',
  ),
  'utf8',
);

function sourceSection(startMarker, endMarker) {
  const start = panelSource.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = panelSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return panelSource.slice(start, end);
}

test('Director review response list can reveal reviews beyond the first 30', () => {
  assert.match(panelSource, /const REVIEW_PAGE_SIZE = 30;/);
  assert.match(panelSource, /const visibleReviews = orderedReviews\.slice\(0, reviewVisibleLimit\);/);
  assert.match(panelSource, /visibleReviews\.map\(\(review\) =>/);
  assert.doesNotMatch(panelSource, /reviews\.slice\(0,\s*30\)/);
  assert.match(panelSource, /reviewVisibleLimit < orderedReviews\.length/);
  assert.match(panelSource, /Показати ще · \$\{orderedReviews\.length - reviewVisibleLimit\}/);
  assert.match(panelSource, /current \+ REVIEW_PAGE_SIZE/);
});

test('review notification prioritizes unanswered reviews while manual More keeps normal order', () => {
  const selectTab = sourceSection('function selectTab(', 'async function load(');
  const openNotice = sourceSection('function openNotice(', 'async function runRestaurant(');
  const orderedReviews = sourceSection('const orderedReviews = useMemo(', 'const visibleReviews =');

  assert.match(selectTab, /if \(next === 'more'\)[\s\S]*setReviewVisibleLimit\(REVIEW_PAGE_SIZE\);[\s\S]*setReviewUnansweredFirst\(false\);/);
  assert.match(openNotice, /setReviewVisibleLimit\(REVIEW_PAGE_SIZE\);[\s\S]*setReviewUnansweredFirst\(true\);[\s\S]*setTab\('more'\);/);
  assert.match(orderedReviews, /if \(!reviewUnansweredFirst\) return reviews;/);
  assert.match(orderedReviews, /return leftAnswered \? 1 : -1;/);
  assert.match(panelSource, /без відповіді спочатку/);
});

test('Director polling remains exactly 15 seconds', () => {
  assert.match(panelSource, /window\.setInterval\(\(\) => void load\(true\), 15_000\)/);
});
