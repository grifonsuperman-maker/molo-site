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

    await queryRunner.query(`
      ALTER TABLE "guest_reviews"
      ADD COLUMN IF NOT EXISTS "response_text" text,
      ADD COLUMN IF NOT EXISTS "responded_at" timestamp,
      ADD COLUMN IF NOT EXISTS "responded_by_name" varchar(160),
      ADD COLUMN IF NOT EXISTS "responded_by_role" varchar(32)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guest_reviews"
      DROP COLUMN IF EXISTS "responded_by_role",
      DROP COLUMN IF EXISTS "responded_by_name",
      DROP COLUMN IF EXISTS "responded_at",
      DROP COLUMN IF EXISTS "response_text"
    `);

    await queryRunner.query(`
      ALTER TABLE "restaurant"
      DROP COLUMN IF EXISTS "admin_can_send_broadcasts",
      DROP COLUMN IF EXISTS "admin_can_manage_staff_shifts",
      DROP COLUMN IF EXISTS "admin_can_respond_reviews",
      DROP COLUMN IF EXISTS "admin_can_manage_blacklist"
    `);
  }
}
