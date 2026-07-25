import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

const TABLE_NAME = 'booking_table_change_requests';
const BOOKING_FK = 'FK_booking_table_change_requests_booking';
const APPROVED_TABLE_FK = 'FK_booking_table_change_requests_approved_table';
const STATUS_CHECK = 'CHK_booking_table_change_requests_status';
const CREATED_AT_INDEX = 'IDX_booking_table_change_requests_created_at';
const PENDING_BOOKING_INDEX = 'UQ_booking_table_change_requests_pending_booking';

export class CreateBookingTableChangeRequests1784930400000 implements MigrationInterface {
  name = 'CreateBookingTableChangeRequests1784930400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      await queryRunner.createTable(
        new Table({
          name: TABLE_NAME,
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            { name: 'booking_id', type: 'uuid' },
            { name: 'requested_table_number', type: 'varchar', length: '32', isNullable: true },
            { name: 'approved_table_id', type: 'uuid', isNullable: true },
            { name: 'status', type: 'varchar', length: '20', default: "'pending'" },
            { name: 'admin_comment', type: 'text', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'now()' },
            { name: 'resolved_at', type: 'timestamp', isNullable: true },
          ],
        }),
        true,
      );
    }

    const table = await queryRunner.getTable(TABLE_NAME);
    if (!table) throw new Error(`Table ${TABLE_NAME} was not created`);

    const hasBookingForeignKey = table.foreignKeys.some(
      (foreignKey) =>
        foreignKey.columnNames.length === 1 &&
        foreignKey.columnNames[0] === 'booking_id' &&
        foreignKey.referencedTableName === 'bookings',
    );
    if (!hasBookingForeignKey) {
      await queryRunner.createForeignKey(
        TABLE_NAME,
        new TableForeignKey({
          name: BOOKING_FK,
          columnNames: ['booking_id'],
          referencedTableName: 'bookings',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    const hasApprovedTableForeignKey = table.foreignKeys.some(
      (foreignKey) =>
        foreignKey.columnNames.length === 1 &&
        foreignKey.columnNames[0] === 'approved_table_id' &&
        foreignKey.referencedTableName === 'tables',
    );
    if (!hasApprovedTableForeignKey) {
      await queryRunner.createForeignKey(
        TABLE_NAME,
        new TableForeignKey({
          name: APPROVED_TABLE_FK,
          columnNames: ['approved_table_id'],
          referencedTableName: 'tables',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }

    if (!table.checks.some((check) => check.name === STATUS_CHECK)) {
      await queryRunner.createCheckConstraint(
        TABLE_NAME,
        new TableCheck({
          name: STATUS_CHECK,
          expression: `"status" IN ('pending', 'approved', 'rejected')`,
        }),
      );
    }

    if (!table.indices.some((index) => index.name === CREATED_AT_INDEX)) {
      await queryRunner.createIndex(
        TABLE_NAME,
        new TableIndex({
          name: CREATED_AT_INDEX,
          columnNames: ['created_at'],
        }),
      );
    }

    if (!table.indices.some((index) => index.name === PENDING_BOOKING_INDEX)) {
      await queryRunner.createIndex(
        TABLE_NAME,
        new TableIndex({
          name: PENDING_BOOKING_INDEX,
          columnNames: ['booking_id'],
          isUnique: true,
          where: `"status" = 'pending'`,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE_NAME))) return;
    await queryRunner.dropTable(TABLE_NAME, true, true, true);
  }
}
