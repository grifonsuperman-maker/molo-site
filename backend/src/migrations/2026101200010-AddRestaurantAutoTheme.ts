import { MigrationInterface, QueryRunner } from 'typeorm';

// Explicit production adoption only: not registered in the application's
// runtime migration list. This additive flag is disabled by default.
export class AddRestaurantAutoTheme2026101200010 implements MigrationInterface {
  name = 'AddRestaurantAutoTheme2026101200010';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "restaurant" ADD COLUMN IF NOT EXISTS "auto_theme_enabled" boolean NOT NULL DEFAULT false',
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
    const [state] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM "restaurant" WHERE "auto_theme_enabled" = true) AS enabled',
    );
    if (state?.enabled) {
      throw new Error('Disable automatic theme on every restaurant before rollback');
    }
    await runner.query(
      'ALTER TABLE "restaurant" DROP COLUMN IF EXISTS "auto_theme_enabled"',
    );
  }
}
