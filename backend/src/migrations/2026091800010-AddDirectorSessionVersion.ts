import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDirectorSessionVersion2026091800010 implements MigrationInterface {
  name = 'AddDirectorSessionVersion2026091800010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff"
      ADD COLUMN IF NOT EXISTS "director_session_version" integer NOT NULL DEFAULT 1
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff"
      DROP COLUMN IF EXISTS "director_session_version"
    `);
  }
}
