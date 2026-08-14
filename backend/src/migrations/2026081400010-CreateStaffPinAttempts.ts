import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStaffPinAttempts2026081400010
  implements MigrationInterface
{
  name = 'CreateStaffPinAttempts2026081400010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_pin_attempts" (
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
      CREATE INDEX IF NOT EXISTS "IDX_staff_pin_attempts_subject"
      ON "staff_pin_attempts" ("scope", "subject_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_pin_attempts_reserved_at"
      ON "staff_pin_attempts" ("reserved_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_pin_attempts_failed_at"
      ON "staff_pin_attempts" ("failed_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_staff_pin_attempts_failed_at"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_staff_pin_attempts_reserved_at"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_staff_pin_attempts_subject"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "staff_pin_attempts"
    `);
  }
}
