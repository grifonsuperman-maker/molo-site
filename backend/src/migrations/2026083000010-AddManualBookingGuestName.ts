import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualBookingGuestName2026083000010 implements MigrationInterface {
  name = 'AddManualBookingGuestName2026083000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "guest_name" character varying(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "guest_name"
    `);
  }
}
