import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = join(root, 'backend'), dist = join(backend, 'dist');
const recordName = '.syrve-application-build.json';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class SyrveBuildIdentityError extends Error {}
function check(condition, message) { if (!condition) throw new SyrveBuildIdentityError(message); }
export function artifactHashes(directory = dist) {
  const result = {};
  const scan = (path, relative = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name === recordName) continue;
      check(!entry.isSymbolicLink(), 'Reviewed build refuses linked artifacts.');
      const name = relative + entry.name;
      if (entry.isDirectory()) scan(join(path, entry.name), name + '/');
      else { check(entry.isFile(), 'Unsupported build artifact.'); result[name] = createHash('sha256').update(readFileSync(join(path, entry.name))).digest('hex'); }
    }
  };
  scan(directory);
  check(Object.keys(result).length > 0, 'Build the reviewed backend first.');
  return result;
}
export const artifactFingerprint = files => digest(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)));
function checkoutIdentity() {
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
    return { commit: git(['rev-parse','HEAD']), tree: git(['rev-parse','HEAD^{tree}']), dirty: Boolean(git(['status','--porcelain','--untracked-files=all'])) };
  } catch { throw new SyrveBuildIdentityError('Use a clean checkout of the reviewed Git commit.'); }
}
export function verifyBuildIdentity(expectedCommit, record, checkout, files, loadedFingerprint) {
  check(/^[0-9a-f]{40}$/.test(expectedCommit || '') && record?.version === 1 && record.sourceCommit === expectedCommit
    && checkout.commit === expectedCommit && record.sourceTree === checkout.tree && !checkout.dirty, 'Build and clean checkout must match the exact reviewed commit.');
  const actual = artifactFingerprint(files);
  check(record.artifactFingerprint === actual && artifactFingerprint(record.files) === actual
    && (!loadedFingerprint || loadedFingerprint === actual), 'Stale or modified build artifacts; rebuild the reviewed commit and restart the planner.');
  return { sourceCommit: record.sourceCommit, sourceTree: record.sourceTree, artifactFingerprint: actual };
}
export function readBuildRecord() {
  try { return JSON.parse(readFileSync(join(dist, recordName), 'utf8')); }
  catch { throw new SyrveBuildIdentityError('Run the reviewed Syrve build command before planning application.'); }
}
export function assertReviewedBuild(expectedCommit, loadedFingerprint) {
  return verifyBuildIdentity(expectedCommit, readBuildRecord(), checkoutIdentity(), artifactHashes(), loadedFingerprint);
}
export function buildReviewedArtifacts() {
  const before = checkoutIdentity();
  check(!before.dirty, 'Commit or discard source edits before building a production application plan.');
  // Remove both emitted code and incremental compiler state; stale files cannot
  // be stamped as outputs from the new source. This never boots the application.
  rmSync(dist, { recursive: true, force: true });
  rmSync(join(backend, 'tsconfig.tsbuildinfo'), { force: true });
  execFileSync(process.execPath, [join(backend, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'], { cwd: backend, stdio: 'inherit' });
  const after = checkoutIdentity();
  check(!after.dirty && before.commit === after.commit && before.tree === after.tree, 'Source changed during the reviewed build.');
  const files = artifactHashes();
  const record = { version: 1, sourceCommit: before.commit, sourceTree: before.tree, artifactFingerprint: artifactFingerprint(files), files };
  writeFileSync(join(dist, recordName), JSON.stringify(record));
  return assertReviewedBuild(before.commit);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv[2] === '--build' && process.argv.length === 3, 'Use --build in a clean reviewed checkout.');
    process.stdout.write(JSON.stringify(buildReviewedArtifacts()) + '\n');
  } catch (error) { console.error(error instanceof SyrveBuildIdentityError ? error.message : 'Reviewed backend build failed.'); process.exitCode = 1; }
}
