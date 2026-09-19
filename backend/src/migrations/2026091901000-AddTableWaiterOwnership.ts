import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTableWaiterOwnership2026091901000 implements MigrationInterface {
  name = 'AddTableWaiterOwnership2026091901000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tables"
      ADD COLUMN IF NOT EXISTS "assigned_waiter_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "tables"
      ADD CONSTRAINT "FK_tables_assigned_waiter"
      FOREIGN KEY ("assigned_waiter_id") REFERENCES "staff"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tables_assigned_waiter"
      ON "tables" ("assigned_waiter_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ assigned: string }> = await queryRunner.query(`
      SELECT count(*)::text AS assigned FROM "tables" WHERE "assigned_waiter_id" IS NOT NULL
    `);
    if (Number(rows[0]?.assigned || 0) > 0) {
      throw new Error('Cannot roll back table ownership while waiters are assigned; release tables first.');
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tables_assigned_waiter"`);
    await queryRunner.query(`ALTER TABLE "tables" DROP CONSTRAINT IF EXISTS "FK_tables_assigned_waiter"`);
    await queryRunner.query(`ALTER TABLE "tables" DROP COLUMN IF EXISTS "assigned_waiter_id"`);
  }
}
