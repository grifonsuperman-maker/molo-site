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
    await queryRunner.createIndex(
      'bookings',
      new TableIndex({
        name: 'IDX_bookings_guest_device_id_hash',
        columnNames: ['guest_device_id_hash'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('bookings', 'IDX_bookings_guest_device_id_hash');
    await queryRunner.dropColumn('bookings', 'guest_device_id_hash');
  }
}
