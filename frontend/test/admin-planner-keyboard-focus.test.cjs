const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = path.resolve(__dirname, '..');
const workspace = fs.readFileSync(path.join(rootPath, 'src/admin/AdminWorkspace.tsx'), 'utf8');
const planner = fs.readFileSync(path.join(rootPath, 'src/admin/AdminVisualTablePlanner.tsx'), 'utf8');

// Exercise the actual photo-sync callback with a focused planner field.
const match = workspace.match(/    const syncPhoto = (\(\) => \{[\s\S]*?\n    \});\n\n    const scheduleSync =/);
assert.ok(match, 'the location photo synchronization callback must remain available');
assert.match(workspace, /new MutationObserver\(scheduleSync\)/);
assert.match(planner, /<textarea value=\{reason\} onChange=\{\(event\) => setReason\(event\.target\.value\)\}/);

let blurCount = 0;
class FakeHTMLElement {
  blur() { blurCount += 1; }
}
const focusedReason = new FakeHTMLElement();
const dayPhoto = '/maps/hall-bg-numbered.png';
const image = {
  alt: 'Зал ресторану',
  src: '/old-photo.png',
  complete: false,
  dataset: {},
  addEventListener() {},
  getAttribute(name) { return name === 'src' ? this.src : null; },
  setAttribute(name, value) { if (name === 'src') this.src = value; },
};
const root = {
  querySelector() { return image; },
  contains(element) { return element === focusedReason; },
};
const context = {
  root,
  LOCATION_PHOTOS: { 'Зал ресторану': dayPhoto },
  URL,
  window: { location: { origin: 'https://molo.example' } },
  document: { activeElement: focusedReason },
  HTMLElement: FakeHTMLElement,
};

function syncPhoto() {
  vm.runInNewContext(`const syncPhoto = ${match[1]}; syncPhoto();`, context);
}

syncPhoto();
assert.equal(image.src, dayPhoto, 'the correct location photo is still selected');
assert.equal(image.dataset.moloDaySrc, dayPhoto, 'photo synchronization is preserved');
assert.equal(blurCount, 0, 'typing the reason must not close the keyboard');

image.complete = true;
syncPhoto();
assert.equal(image.dataset.moloPhotoLoading, 'false', 'the loaded photo is still revealed');
assert.equal(blurCount, 0, 'subsequent photo synchronization must keep input focused');

console.log('admin planner keyboard focus regression passed');
