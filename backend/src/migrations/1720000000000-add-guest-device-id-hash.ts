import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestDeviceIdHash1720000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "guest_device_id_hash" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bookings_guest_device_id_hash"
      ON "bookings" ("guest_device_id_hash")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_bookings_guest_device_id_hash"');
    await queryRunner.query('ALTER TABLE "bookings" DROP COLUMN IF EXISTS "guest_device_id_hash"');
  }
}
