import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWaiterCalls2026081500010 implements MigrationInterface {
  name = 'CreateWaiterCalls2026081500010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "waiter_calls" (
        "id" varchar(80) NOT NULL,
        "booking_id" uuid NOT NULL,
        "table_id" uuid,
        "table_number" varchar(32),
        "client_name" varchar(160),
        "waiter_id" uuid,
        "waiter_name" varchar(160),
        "assignment_active" boolean NOT NULL DEFAULT true,
        "status" varchar(16) NOT NULL DEFAULT 'new',
        "accepted_at" timestamptz,
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_waiter_calls" PRIMARY KEY ("id"),
        CONSTRAINT "FK_waiter_calls_booking"
          FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_waiter_calls_status"
          CHECK ("status" IN ('new', 'accepted', 'closed'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_waiter_calls_active_booking"
      ON "waiter_calls" ("booking_id")
      WHERE "status" IN ('new', 'accepted')
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_waiter_calls_status_created_at"
      ON "waiter_calls" ("status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_waiter_calls_waiter_assignment"
      ON "waiter_calls" ("waiter_id", "assignment_active")
    `);

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
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_bookings_close_waiter_calls_when_inactive" ON "bookings"
    `);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS "close_waiter_calls_when_booking_inactive"()
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_waiter_calls_waiter_assignment"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_waiter_calls_status_created_at"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_waiter_calls_active_booking"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "waiter_calls"
    `);
  }
}