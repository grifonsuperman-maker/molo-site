import { pathToFileURL } from 'node:url';
import {
  assertOperatorIntent,
  OperatorGuardError,
  operateGuestPushMigration,
} from './guest-push-migration-operator.mjs';

export const TEST_APPLY_ROLE = 'molo_push_migration_runner';
export const TEST_APPLY_APPROVAL = 'apply-guest-push-subscriptions-to-test-push-migration';

export function assertTestApplyIntent(env) {
  if (
    env.MOLO_PUSH_BRANCH !== 'test-push-migration' ||
    env.MOLO_PUSH_APPROVAL !== TEST_APPLY_APPROVAL ||
    env.DB_SYNCHRONIZE !== 'false'
  ) {
    throw new OperatorGuardError('Test-only migration requires the exact test branch, approval and disabled synchronization.');
  }

  const target = assertOperatorIntent('--apply', env);
  const connection = new URL(target.url);
  if (
    connection.username !== TEST_APPLY_ROLE ||
    /-pooler(?:\.|$)/i.test(connection.hostname) ||
    (connection.port && connection.port !== '5432')
  ) {
    throw new OperatorGuardError('Use the dedicated test-only migration role and a direct Neon connection.');
  }
  return target;
}

export async function applyGuestPushToTest(env = process.env) {
  if (env !== process.env) {
    throw new OperatorGuardError('The test-only runner requires the validated process environment.');
  }
  assertTestApplyIntent(env);
  return operateGuestPushMigration('--apply', env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${await applyGuestPushToTest()}\n`);
  } catch (error) {
    // Driver errors can contain connection details. Never print them to Actions logs.
    console.error(error instanceof OperatorGuardError ? error.message : 'Test migration failed; inspect private database logs.');
    process.exitCode = 1;
  }
}
