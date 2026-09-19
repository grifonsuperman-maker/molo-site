import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTableWaiterOwnership2026091901000 implements MigrationInterface {
  name = 'AddTableWaiterOwnership2026091901000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Before launch there is no trustworthy owner for an already occupied table.
    // Fail before changing the schema rather than silently make an active visit unowned.
    const activeTables: Array<{ count: number | string }> = await queryRunner.query(`
      SELECT COUNT(*)::int AS count FROM "tables" WHERE "status" IN ('occupied', 'cleaning')
    `);
    if (Number(activeTables[0]?.count || 0) > 0) {
      throw new Error('Перед встановленням закріплення офіціантів звільніть усі зайняті столи та завершіть прибирання');
    }

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

    // Every release path (including booking expiration and legacy transfers) must
    // clear the owner in the SAME database update, even when it bypasses TablesService.
    // Cleaning retains the owner until the table is actually released.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "clear_waiter_owner_on_table_release"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."status" IN ('free', 'pending', 'reserved') THEN
          NEW."assigned_waiter_id" := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_tables_clear_waiter_owner_on_release"
      BEFORE INSERT OR UPDATE ON "tables"
      FOR EACH ROW
      EXECUTE FUNCTION "clear_waiter_owner_on_table_release"()
    `);
    await queryRunner.query(`
      UPDATE "tables"
      SET "assigned_waiter_id" = NULL
      WHERE "status" IN ('free', 'pending', 'reserved')
        AND "assigned_waiter_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_tables_clear_waiter_owner_on_release" ON "tables"
    `);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS "clear_waiter_owner_on_table_release"()
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tables_assigned_waiter"`);
    await queryRunner.query(`ALTER TABLE "tables" DROP CONSTRAINT IF EXISTS "FK_tables_assigned_waiter"`);
    // Ownership is transient operational state. Reverting the feature deliberately
    // discards assignments; it must not fail merely because a waiter used it.
    await queryRunner.query(`ALTER TABLE "tables" DROP COLUMN IF EXISTS "assigned_waiter_id"`);
  }
}
