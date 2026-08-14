import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStaffPinAttempts2026081400010
  implements MigrationInterface
{
  name = 'CreateStaffPinAttempts2026081400010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_pin_attempts" (
        "scope" varchar(32) NOT NULL,
        "subject_hash" char(64) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "window_started_at" timestamp NOT NULL DEFAULT NOW(),
        "locked_until" timestamp,
        "updated_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_staff_pin_attempts" PRIMARY KEY ("scope", "subject_hash"),
        CONSTRAINT "CHK_staff_pin_attempts_count_nonnegative" CHECK ("attempt_count" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_pin_attempts_updated_at"
      ON "staff_pin_attempts" ("updated_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_staff_pin_attempts_updated_at"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "staff_pin_attempts"
    `);
  }
}
