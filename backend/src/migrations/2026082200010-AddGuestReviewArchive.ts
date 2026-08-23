import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestReviewArchive2026082200010 implements MigrationInterface {
  name = 'AddGuestReviewArchive2026082200010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "guest_review_archives" (
        "guest_review_id" UUID NOT NULL,
        "archived_at" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_guest_review_archives" PRIMARY KEY ("guest_review_id"),
        CONSTRAINT "FK_guest_review_archives_review"
          FOREIGN KEY ("guest_review_id")
          REFERENCES "guest_reviews"("id")
          ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "guest_review_archives"
    `);
  }
}
