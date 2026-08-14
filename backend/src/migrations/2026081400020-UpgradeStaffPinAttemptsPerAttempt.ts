import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpgradeStaffPinAttemptsPerAttempt2026081400020
  implements MigrationInterface
{
  name = 'UpgradeStaffPinAttemptsPerAttempt2026081400020';

  async up(queryRunner: QueryRunner): Promise<void> {
    // PIN-attempt rows are temporary security state. Recreate this new table so
    // environments that briefly ran the earlier aggregate migration converge on
    // the final per-attempt schema without touching restaurant business data.
    await queryRunner.query(`
      DROP TABLE IF EXISTS "staff_pin_attempts"
    `);

    await queryRunner.query(`
      CREATE TABLE "staff_pin_attempts" (
        "id" bigserial NOT NULL,
        "scope" varchar(32) NOT NULL,
        "subject_hash" char(64) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "reserved_at" timestamptz NOT NULL DEFAULT NOW(),
        "failed_at" timestamptz,
        "locked_until" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_staff_pin_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_staff_pin_attempts_status" CHECK ("status" IN ('pending', 'failed'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_staff_pin_attempts_subject"
      ON "staff_pin_attempts" ("scope", "subject_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_staff_pin_attempts_reserved_at"
      ON "staff_pin_attempts" ("reserved_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_staff_pin_attempts_failed_at"
      ON "staff_pin_attempts" ("failed_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "staff_pin_attempts"
    `);

    await queryRunner.query(`
      CREATE TABLE "staff_pin_attempts" (
        "scope" varchar(32) NOT NULL,
        "subject_hash" char(64) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "window_started_at" timestamptz NOT NULL DEFAULT NOW(),
        "locked_until" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_staff_pin_attempts" PRIMARY KEY ("scope", "subject_hash"),
        CONSTRAINT "CHK_staff_pin_attempts_count_nonnegative" CHECK ("attempt_count" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_staff_pin_attempts_updated_at"
      ON "staff_pin_attempts" ("updated_at")
    `);
  }
}
