import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTableWaiterOwnership2026091901000 implements MigrationInterface {
  name = 'AddTableWaiterOwnership2026091901000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // This guard must remain effective until the new column, FK and release
    // trigger have been installed. Without a transaction the lock would be
    // released between statements, making the cutover check unsafe.
    if (!queryRunner.isTransactionActive) {
      throw new Error('Міграцію закріплення офіціантів необхідно виконувати в одній транзакції');
    }
    await queryRunner.query('LOCK TABLE "tables" IN ACCESS EXCLUSIVE MODE');

    // Before launch there is no trustworthy owner for an already occupied table.
    // Block concurrent table writes before checking; fail rather than silently
    // make an in-progress visit unowned.
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
    // In existing deployments TypeORM may have already created this FK during
    // schema synchronization. Do not fail when the constraint is already present.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"tables"'::regclass AND conname = 'FK_tables_assigned_waiter'
        ) THEN
          ALTER TABLE "tables"
          ADD CONSTRAINT "FK_tables_assigned_waiter"
          FOREIGN KEY ("assigned_waiter_id") REFERENCES "staff"("id")
          ON DELETE SET NULL;
        END IF;
      END;
      $$
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
