import { MigrationInterface, QueryRunner } from 'typeorm';

export class CloseInactiveWaiterCalls2026081500020
  implements MigrationInterface
{
  name = 'CloseInactiveWaiterCalls2026081500020';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "close_waiter_calls_when_booking_inactive"()
      RETURNS trigger AS $$
      BEGIN
        UPDATE "waiter_calls"
        SET
          "status" = CASE
            WHEN "status" IN ('new', 'accepted') THEN 'closed'
            ELSE "status"
          END,
          "closed_at" = CASE
            WHEN "status" IN ('new', 'accepted') THEN COALESCE("closed_at", CURRENT_TIMESTAMP)
            ELSE "closed_at"
          END,
          "assignment_active" = false,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "booking_id" = NEW."id"
          AND (
            "status" IN ('new', 'accepted')
            OR "assignment_active" = true
          );

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_bookings_close_waiter_calls_when_inactive" ON "bookings"
    `);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_bookings_close_waiter_calls_when_inactive"
      AFTER UPDATE OF "status" ON "bookings"
      FOR EACH ROW
      WHEN (
        OLD."status" IS DISTINCT FROM NEW."status"
        AND NEW."status" IN ('rejected', 'cancelled', 'completed')
      )
      EXECUTE FUNCTION "close_waiter_calls_when_booking_inactive"()
    `);

    await queryRunner.query(`
      UPDATE "waiter_calls" AS waiter_call
      SET
        "status" = CASE
          WHEN waiter_call."status" IN ('new', 'accepted') THEN 'closed'
          ELSE waiter_call."status"
        END,
        "closed_at" = CASE
          WHEN waiter_call."status" IN ('new', 'accepted')
            THEN COALESCE(waiter_call."closed_at", CURRENT_TIMESTAMP)
          ELSE waiter_call."closed_at"
        END,
        "assignment_active" = false,
        "updated_at" = CURRENT_TIMESTAMP
      FROM "bookings" AS booking
      WHERE booking."id" = waiter_call."booking_id"
        AND booking."status" IN ('rejected', 'cancelled', 'completed')
        AND (
          waiter_call."status" IN ('new', 'accepted')
          OR waiter_call."assignment_active" = true
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_bookings_close_waiter_calls_when_inactive" ON "bookings"
    `);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS "close_waiter_calls_when_booking_inactive"()
    `);
  }
}
