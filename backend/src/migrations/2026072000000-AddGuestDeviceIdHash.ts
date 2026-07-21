import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

const TABLE_NAME = 'bookings';

const DEVICE_INDEX_NAME = 'IDX_bookings_guest_device_id_hash';
const ACTIVE_DEVICE_INDEX_NAME = 'UQ_bookings_active_guest_device_date';
const ACTIVE_PHONE_INDEX_NAME = 'UQ_bookings_active_guest_phone_date';

export class AddGuestDeviceIdHash2026072000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable(TABLE_NAME);

    if (!tableExists) {
      return;
    }

    const hasDeviceHashColumn = await queryRunner.hasColumn(
      TABLE_NAME,
      'guest_device_id_hash',
    );

    if (!hasDeviceHashColumn) {
      await queryRunner.addColumn(
        TABLE_NAME,
        new TableColumn({
          name: 'guest_device_id_hash',
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      );
    }

    const hasNormalizedPhoneColumn = await queryRunner.hasColumn(
      TABLE_NAME,
      'guest_phone_normalized',
    );

    if (!hasNormalizedPhoneColumn) {
      await queryRunner.addColumn(
        TABLE_NAME,
        new TableColumn({
          name: 'guest_phone_normalized',
          type: 'varchar',
          length: '32',
          isNullable: true,
        }),
      );
    }

    let table = await queryRunner.getTable(TABLE_NAME);

    if (!table) {
      return;
    }

    const hasDeviceIndex = table.indices.some(
      (index) => index.name === DEVICE_INDEX_NAME,
    );

    if (!hasDeviceIndex) {
      await queryRunner.createIndex(
        TABLE_NAME,
        new TableIndex({
          name: DEVICE_INDEX_NAME,
          columnNames: ['guest_device_id_hash'],
        }),
      );
    }

    table = await queryRunner.getTable(TABLE_NAME);

    if (!table) {
      return;
    }

    const hasActiveDeviceIndex = table.indices.some(
      (index) => index.name === ACTIVE_DEVICE_INDEX_NAME,
    );

    if (!hasActiveDeviceIndex) {
      await queryRunner.createIndex(
        TABLE_NAME,
        new TableIndex({
          name: ACTIVE_DEVICE_INDEX_NAME,
          columnNames: ['booking_date', 'guest_device_id_hash'],
          isUnique: true,
          where:
            `"guest_device_id_hash" IS NOT NULL AND "status" IN ('pending', 'approved')`,
        }),
      );
    }

    table = await queryRunner.getTable(TABLE_NAME);

    if (!table) {
      return;
    }

    const hasActivePhoneIndex = table.indices.some(
      (index) => index.name === ACTIVE_PHONE_INDEX_NAME,
    );

    if (!hasActivePhoneIndex) {
      await queryRunner.createIndex(
        TABLE_NAME,
        new TableIndex({
          name: ACTIVE_PHONE_INDEX_NAME,
          columnNames: ['booking_date', 'guest_phone_normalized'],
          isUnique: true,
          where:
            `"guest_phone_normalized" IS NOT NULL AND "status" IN ('pending', 'approved')`,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable(TABLE_NAME);

    if (!tableExists) {
      return;
    }

    let table = await queryRunner.getTable(TABLE_NAME);

    if (!table) {
      return;
    }

    if (
      table.indices.some(
        (index) => index.name === ACTIVE_PHONE_INDEX_NAME,
      )
    ) {
      await queryRunner.dropIndex(
        TABLE_NAME,
        ACTIVE_PHONE_INDEX_NAME,
      );
    }

    table = await queryRunner.getTable(TABLE_NAME);

    if (
      table?.indices.some(
        (index) => index.name === ACTIVE_DEVICE_INDEX_NAME,
      )
    ) {
      await queryRunner.dropIndex(
        TABLE_NAME,
        ACTIVE_DEVICE_INDEX_NAME,
      );
    }

    table = await queryRunner.getTable(TABLE_NAME);

    if (
      table?.indices.some(
        (index) => index.name === DEVICE_INDEX_NAME,
      )
    ) {
      await queryRunner.dropIndex(
        TABLE_NAME,
        DEVICE_INDEX_NAME,
      );
    }

    const hasNormalizedPhoneColumn = await queryRunner.hasColumn(
      TABLE_NAME,
      'guest_phone_normalized',
    );

    if (hasNormalizedPhoneColumn) {
      await queryRunner.dropColumn(
        TABLE_NAME,
        'guest_phone_normalized',
      );
    }

    const hasDeviceHashColumn = await queryRunner.hasColumn(
      TABLE_NAME,
      'guest_device_id_hash',
    );

    if (hasDeviceHashColumn) {
      await queryRunner.dropColumn(
        TABLE_NAME,
        'guest_device_id_hash',
      );
    }
  }
}
