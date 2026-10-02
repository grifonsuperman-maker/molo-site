import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookingTableAssignments2026100200010
  implements MigrationInterface
{
  name = 'CreateBookingTableAssignments2026100200010';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      throw new Error(
        'Booking table assignment migration requires an active transaction',
      );
    }

    // Keep the one-time backfill stable while the relation is created.
    await queryRunner.query('LOCK TABLE "bookings" IN SHARE ROW EXCLUSIVE MODE');

    await queryRunner.query(`CREATE TABLE "booking_table_assignments" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "booking_id" uuid NOT NULL,
      "table_id" uuid NOT NULL,
      "is_primary" boolean NOT NULL DEFAULT false,
      "created_at" timestamp without time zone NOT NULL DEFAULT now(),
      CONSTRAINT "PK_booking_table_assignments" PRIMARY KEY ("id"),
      CONSTRAINT "FK_booking_table_assignments_booking"
        FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE,
      CONSTRAINT "FK_booking_table_assignments_table"
        FOREIGN KEY ("table_id") REFERENCES "tables" ("id") ON DELETE CASCADE
    )`);

    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_booking_table_assignments_booking_table"
      ON "booking_table_assignments" ("booking_id", "table_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_booking_table_assignments_primary_booking"
      ON "booking_table_assignments" ("booking_id")
      WHERE "is_primary" = true`);
    await queryRunner.query(`CREATE INDEX "IDX_booking_table_assignments_table"
      ON "booking_table_assignments" ("table_id")`);

    await queryRunner.query(`INSERT INTO "booking_table_assignments"
      ("booking_id", "table_id", "is_primary")
      SELECT "id", "table_id", true
      FROM "bookings"
      WHERE "table_id" IS NOT NULL
      ON CONFLICT ("booking_id", "table_id") DO NOTHING`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      throw new Error(
        'Booking table assignment rollback requires an active transaction',
      );
    }

    await queryRunner.query(
      'LOCK TABLE "booking_table_assignments" IN ACCESS EXCLUSIVE MODE',
    );
    await queryRunner.query('LOCK TABLE "bookings" IN SHARE ROW EXCLUSIVE MODE');

    const [state] = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1
        FROM "booking_table_assignments" AS assignment
        JOIN "bookings" AS booking ON booking."id" = assignment."booking_id"
        WHERE assignment."is_primary" = false
           OR booking."table_id" IS DISTINCT FROM assignment."table_id"
      ) AS unsafe
    `);

    if (state?.unsafe) {
      throw new Error(
        'Cannot roll back booking table assignments while secondary or non-legacy table assignments exist',
      );
    }

    await queryRunner.query('DROP TABLE "booking_table_assignments"');
  }
}
