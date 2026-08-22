import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestReviewArchive2026082200010 implements MigrationInterface {
  name = 'AddGuestReviewArchive2026082200010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guest_reviews"
      ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guest_reviews"
      DROP COLUMN IF EXISTS "archived_at"
    `);
  }
}
