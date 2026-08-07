import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHookahCallAvailability1786057200000
  implements MigrationInterface
{
  name = "AddHookahCallAvailability1786057200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "restaurant"
      ADD COLUMN IF NOT EXISTS "hookah_calls_available" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "hookah_calls_availability_changed_at" timestamp
    `);

    await queryRunner.query(`
      ALTER TABLE "hookah_calls"
      ADD COLUMN IF NOT EXISTS "eta_due_at" timestamp,
      ADD COLUMN IF NOT EXISTS "waiter_name" varchar(160)
    `);

    await queryRunner.query(`
      UPDATE "hookah_calls"
      SET "eta_due_at" = "accepted_at" + ("eta_minutes" * interval '1 minute')
      WHERE "status" = 'accepted'
        AND "accepted_at" IS NOT NULL
        AND "eta_minutes" IS NOT NULL
        AND "eta_due_at" IS NULL
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "booking_id"
          ORDER BY "created_at" DESC, "id" DESC
        ) AS position
        FROM "hookah_calls"
        WHERE "status" IN ('new', 'accepted')
      )
      UPDATE "hookah_calls" AS calls
      SET "status" = 'cancelled',
          "cancelled_at" = COALESCE(calls."cancelled_at", now()),
          "cancel_reason" = COALESCE(calls."cancel_reason", 'Автоматично закрито під час оновлення')
      FROM ranked
      WHERE calls."id" = ranked."id" AND ranked.position > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_hookah_calls_active_booking"
      ON "hookah_calls" ("booking_id")
      WHERE "status" IN ('new', 'accepted')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_hookah_calls_active_booking"',
    );
    await queryRunner.query(`
      ALTER TABLE "hookah_calls"
      DROP COLUMN IF EXISTS "waiter_name",
      DROP COLUMN IF EXISTS "eta_due_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "restaurant"
      DROP COLUMN IF EXISTS "hookah_calls_availability_changed_at",
      DROP COLUMN IF EXISTS "hookah_calls_available"
    `);
  }
}
