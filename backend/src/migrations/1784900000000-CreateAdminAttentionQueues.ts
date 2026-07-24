import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateAdminAttentionQueues1784900000000 implements MigrationInterface {
  name = 'CreateAdminAttentionQueues1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('booking_table_change_requests'))) {
      await queryRunner.createTable(
        new Table({
          name: 'booking_table_change_requests',
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
            { name: 'requested_table_number', type: 'varchar', length: '64', isNullable: true },
            { name: 'status', type: 'varchar', length: '24', default: "'pending'" },
            { name: 'admin_comment', type: 'text', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'now()' },
            { name: 'resolved_at', type: 'timestamp', isNullable: true },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKey(
        'booking_table_change_requests',
        new TableForeignKey({
          name: 'FK_booking_table_change_requests_booking',
          columnNames: ['booking_id'],
          referencedTableName: 'bookings',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createIndex(
        'booking_table_change_requests',
        new TableIndex({
          name: 'IDX_booking_table_change_requests_created_at',
          columnNames: ['created_at'],
        }),
      );

      await queryRunner.createCheckConstraint(
        'booking_table_change_requests',
        new TableCheck({
          name: 'CHK_booking_table_change_requests_status',
          expression: `status IN ('pending', 'approved', 'rejected')`,
        }),
      );

      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_booking_table_change_requests_pending_booking" ON "booking_table_change_requests" ("booking_id") WHERE "status" = 'pending'`,
      );
    }

    if (!(await queryRunner.hasTable('admin_calls'))) {
      await queryRunner.createTable(
        new Table({
          name: 'admin_calls',
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
            { name: 'status', type: 'varchar', length: '24', default: "'new'" },
            { name: 'accepted_at', type: 'timestamp', isNullable: true },
            { name: 'completed_at', type: 'timestamp', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'now()' },
            { name: 'updated_at', type: 'timestamp', default: 'now()' },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKey(
        'admin_calls',
        new TableForeignKey({
          name: 'FK_admin_calls_booking',
          columnNames: ['booking_id'],
          referencedTableName: 'bookings',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createIndex(
        'admin_calls',
        new TableIndex({
          name: 'IDX_admin_calls_status_created_at',
          columnNames: ['status', 'created_at'],
        }),
      );

      await queryRunner.createCheckConstraint(
        'admin_calls',
        new TableCheck({
          name: 'CHK_admin_calls_status',
          expression: `status IN ('new', 'accepted', 'completed')`,
        }),
      );

      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_admin_calls_active_booking" ON "admin_calls" ("booking_id") WHERE "status" IN ('new', 'accepted')`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_calls')) {
      await queryRunner.dropTable('admin_calls', true, true, true);
    }
    if (await queryRunner.hasTable('booking_table_change_requests')) {
      await queryRunner.dropTable('booking_table_change_requests', true, true, true);
    }
  }
}
