import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddGuestDeviceIdHash2026072000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'bookings',
      new TableColumn({
        name: 'guest_device_id_hash',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'bookings',
      new TableColumn({
        name: 'guest_phone_normalized',
        type: 'varchar',
        length: '32',
        isNullable: true,
      }),
    );
    await queryRunner.createIndex(
      'bookings',
      new TableIndex({
        name: 'IDX_bookings_guest_device_id_hash',
        columnNames: ['guest_device_id_hash'],
      }),
    );
    await queryRunner.createIndex(
      'bookings',
      new TableIndex({
        name: 'UQ_bookings_active_guest_device_date',
        columnNames: ['booking_date', 'guest_device_id_hash'],
        isUnique: true,
        where: "guest_device_id_hash IS NOT NULL AND status IN ('pending', 'approved')",
      }),
    );
    await queryRunner.createIndex(
      'bookings',
      new TableIndex({
        name: 'UQ_bookings_active_guest_phone_date',
        columnNames: ['booking_date', 'guest_phone_normalized'],
        isUnique: true,
        where: "guest_phone_normalized IS NOT NULL AND status IN ('pending', 'approved')",
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('bookings', 'UQ_bookings_active_guest_phone_date');
    await queryRunner.dropIndex('bookings', 'UQ_bookings_active_guest_device_date');
    await queryRunner.dropIndex('bookings', 'IDX_bookings_guest_device_id_hash');
    await queryRunner.dropColumn('bookings', 'guest_phone_normalized');
    await queryRunner.dropColumn('bookings', 'guest_device_id_hash');
  }
}
