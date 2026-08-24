import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLogArchive2026082400010 implements MigrationInterface {
  name = 'AddLogArchive2026082400010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "log_archives" (
        "log_id" UUID NOT NULL,
        "archived_at" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_log_archives" PRIMARY KEY ("log_id"),
        CONSTRAINT "FK_log_archives_log"
          FOREIGN KEY ("log_id") REFERENCES "logs"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_log_archives_archived_at"
      ON "log_archives" ("archived_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "log_archives"`);
  }
}
