import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWaiterCallAssignmentActive2026081500015
  implements MigrationInterface
{
  name = 'AddWaiterCallAssignmentActive2026081500015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "waiter_calls"
      ADD COLUMN IF NOT EXISTS "assignment_active" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_waiter_calls_waiter_status"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_waiter_calls_waiter_assignment"
      ON "waiter_calls" ("waiter_id", "assignment_active")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const lifecycleTriggerRows = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'TRG_bookings_close_waiter_calls_when_inactive'
          AND tgrelid = 'bookings'::regclass
          AND NOT tgisinternal
      ) AS "exists"
    `);

    if (lifecycleTriggerRows?.[0]?.exists === true) {
      return;
    }

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_waiter_calls_waiter_assignment"
    `);

    await queryRunner.query(`
      ALTER TABLE "waiter_calls"
      DROP COLUMN IF EXISTS "assignment_active"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_waiter_calls_waiter_status"
      ON "waiter_calls" ("waiter_id", "status")
    `);
  }
}
