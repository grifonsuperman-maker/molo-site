import { MigrationInterface, QueryRunner } from 'typeorm';

// Additive, default-off setting: deployed restaurants keep their manual theme.
// Apply this migration before deploying code that reads auto_theme_enabled.
export class AddRestaurantAutoTheme2026101200010 implements MigrationInterface {
  name = 'AddRestaurantAutoTheme2026101200010';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "restaurant" ADD COLUMN IF NOT EXISTS "auto_theme_enabled" boolean NOT NULL DEFAULT false',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "restaurant" DROP COLUMN "auto_theme_enabled"',
    );
  }
}
