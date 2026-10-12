import { MigrationInterface, QueryRunner } from 'typeorm';

// Explicit production adoption only: not registered in the application's
// runtime migration list. This additive flag is disabled by default.
export class AddRestaurantAutoTheme2026101200010 implements MigrationInterface {
  name = 'AddRestaurantAutoTheme2026101200010';

  async up(runner: QueryRunner): Promise<void> {
    // Do not adopt a preexisting column: its ownership and rollback are unknown.
    // ALTER takes ACCESS EXCLUSIVE, so the existence check and addition must
    // stay in the same migration transaction.
    if (!runner.isTransactionActive) {
      throw new Error('Auto-theme migration requires an active transaction');
    }
    await runner.query('LOCK TABLE "restaurant" IN ACCESS EXCLUSIVE MODE');
    const [existing] = await runner.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurant' AND column_name = 'auto_theme_enabled') AS present",
    );
    if (existing?.present) {
      throw new Error('auto_theme_enabled already exists; audit before applying migration');
    }
    await runner.query(
      'ALTER TABLE "restaurant" ADD COLUMN "auto_theme_enabled" boolean NOT NULL DEFAULT false',
    );
    // IF NOT EXISTS must never silently accept an incompatible existing column.
    const [column] = await runner.query(
      "SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurant' AND column_name = 'auto_theme_enabled'",
    );
    if (
      !column ||
      column.data_type !== 'boolean' ||
      column.is_nullable !== 'NO' ||
      !['false', 'false::boolean'].includes(column.column_default)
    ) {
      throw new Error('auto_theme_enabled has an unexpected schema; abort migration');
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) {
      throw new Error('Auto-theme rollback requires an active transaction');
    }
    // Fence concurrent writes until the flag has been checked and dropped.
    await runner.query('LOCK TABLE "restaurant" IN ACCESS EXCLUSIVE MODE');
    const [state] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM "restaurant" WHERE "auto_theme_enabled" = true) AS enabled',
    );
    if (state?.enabled) {
      throw new Error('Disable automatic theme on every restaurant before rollback');
    }
    await runner.query(
      'ALTER TABLE "restaurant" DROP COLUMN "auto_theme_enabled"',
    );
  }
}
