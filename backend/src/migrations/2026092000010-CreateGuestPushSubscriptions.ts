import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGuestPushSubscriptions2026092000010 implements MigrationInterface {
  name = 'CreateGuestPushSubscriptions2026092000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    // No existing booking rows or columns are changed by this migration.
    await queryRunner.query(`
      CREATE TABLE "guest_push_subscriptions" (
        "booking_id" uuid NOT NULL,
        "endpoint_hash" character varying(64) NOT NULL,
        "guest_device_id_hash" character varying(64) NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "created_at" timestamp without time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guest_push_subscriptions" PRIMARY KEY ("booking_id", "endpoint_hash"),
        CONSTRAINT "FK_guest_push_subscriptions_booking"
          FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The lock must persist through the empty check and DROP in one transaction.
    if (!queryRunner.isTransactionActive) {
      throw new Error('Guest push subscription rollback requires an active transaction');
    }

    const [table] = await queryRunner.query(`
      SELECT to_regclass('public.guest_push_subscriptions') IS NOT NULL AS "present"
    `);
    if (!table?.present) return;

    // Block concurrent inserts before checking emptiness; keep this lock until DROP.
    await queryRunner.query('LOCK TABLE "guest_push_subscriptions" IN ACCESS EXCLUSIVE MODE');
    const [state] = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM "guest_push_subscriptions") AS "hasSubscriptions"
    `);
    if (state?.hasSubscriptions) {
      throw new Error('Cannot revert guest push subscriptions while subscription records exist');
    }

    await queryRunner.query('DROP TABLE "guest_push_subscriptions"');
  }
}
