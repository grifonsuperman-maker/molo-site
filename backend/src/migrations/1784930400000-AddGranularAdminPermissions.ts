import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGranularAdminPermissions1784930400000 implements MigrationInterface {
  name = 'AddGranularAdminPermissions1784930400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurant"
      ADD COLUMN IF NOT EXISTS "admin_can_manage_blacklist" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "admin_can_respond_reviews" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "admin_can_manage_staff_shifts" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "admin_can_send_broadcasts" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurant"
      DROP COLUMN IF EXISTS "admin_can_send_broadcasts",
      DROP COLUMN IF EXISTS "admin_can_manage_staff_shifts",
      DROP COLUMN IF EXISTS "admin_can_respond_reviews",
      DROP COLUMN IF EXISTS "admin_can_manage_blacklist"
    `);
  }
}
