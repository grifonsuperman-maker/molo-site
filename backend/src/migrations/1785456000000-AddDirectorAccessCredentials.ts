import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDirectorAccessCredentials1785456000000
  implements MigrationInterface
{
  name = 'AddDirectorAccessCredentials1785456000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff"
      ADD COLUMN IF NOT EXISTS "director_login_name" varchar(64),
      ADD COLUMN IF NOT EXISTS "director_password_hash" text,
      ADD COLUMN IF NOT EXISTS "director_credentials_configured_at" timestamp,
      ADD COLUMN IF NOT EXISTS "director_failed_login_attempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "director_locked_until" timestamp
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_director_login_name"
      ON "staff" ("director_login_name")
      WHERE "director_login_name" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_staff_director_login_name"
    `);

    await queryRunner.query(`
      ALTER TABLE "staff"
      DROP COLUMN IF EXISTS "director_locked_until",
      DROP COLUMN IF EXISTS "director_failed_login_attempts",
      DROP COLUMN IF EXISTS "director_credentials_configured_at",
      DROP COLUMN IF EXISTS "director_password_hash",
      DROP COLUMN IF EXISTS "director_login_name"
    `);
  }
}
