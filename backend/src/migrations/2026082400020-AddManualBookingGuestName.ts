import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualBookingGuestName2026082400020 implements MigrationInterface {
  name = 'AddManualBookingGuestName2026082400020';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "guest_name" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "guest_name"
    `);
  }
}
