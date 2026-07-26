import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairStaffShiftEvents1785448800000 implements MigrationInterface {
  name = 'RepairStaffShiftEvents1785448800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_shift_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_type" varchar(32) NOT NULL,
        "performed_by" varchar,
        "comment" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "staffId" uuid NOT NULL,
        CONSTRAINT "PK_staff_shift_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_staff_shift_events_staff_created"
      ON "staff_shift_events" ("staffId", "created_at")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_staff_shift_events_staff'
        ) THEN
          ALTER TABLE "staff_shift_events"
          ADD CONSTRAINT "FK_staff_shift_events_staff"
          FOREIGN KEY ("staffId") REFERENCES "staff"("id")
          ON DELETE CASCADE;
        END IF;
      END
      $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_staff_shift_events_staff_created"',
    );
  }
}
