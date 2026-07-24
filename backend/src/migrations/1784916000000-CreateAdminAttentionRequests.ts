import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateAdminAttentionRequests1784916000000
  implements MigrationInterface
{
  name = 'CreateAdminAttentionRequests1784916000000';

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
            {
              name: 'requested_table_number',
              type: 'varchar',
              length: '40',
              isNullable: true,
            },
            { name: 'selected_table_id', type: 'uuid', isNullable: true },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'pending'",
            },
            { name: 'admin_comment', type: 'text', isNullable: true },
            { name: 'created_at', type: 'timestamp', default: 'now()' },
            { name: 'resolved_at', type: 'timestamp', isNullable: true },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKeys('booking_table_change_requests', [
        new TableForeignKey({
          name: 'FK_booking_table_change_requests_booking',
          columnNames: ['booking_id'],
          referencedTableName: 'bookings',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
        new TableForeignKey({
          name: 'FK_booking_table_change_requests_selected_table',
          columnNames: ['selected_table_id'],
          referencedTableName: 'tables',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      ]);

      await queryRunner.createCheckConstraint(
        'booking_table_change_requests',
        new TableCheck({
          name: 'CHK_booking_table_change_requests_status',
          expression: `status IN ('pending', 'approved', 'rejected')`,
        }),
      );

      await queryRunner.createIndex(
        'booking_table_change_requests',
        new TableIndex({
          name: 'IDX_booking_table_change_requests_created_at',
          columnNames: ['created_at'],
        }),
      );

      await queryRunner.createIndex(
        'booking_table_change_requests',
        new TableIndex({
          name: 'UQ_booking_table_change_requests_pending_booking',
          columnNames: ['booking_id'],
          isUnique: true,
          where: `status = 'pending'`,
        }),
      );
    }

    if (!(await queryRunner.hasTable('guest_admin_calls'))) {
      await queryRunner.createTable(
        new Table({
          name: 'guest_admin_calls',
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
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'new'",
            },
            { name: 'created_at', type: 'timestamp', default: 'now()' },
            { name: 'accepted_at', type: 'timestamp', isNullable: true },
            { name: 'completed_at', type: 'timestamp', isNullable: true },
          ],
        }),
        true,
      );

      await queryRunner.createForeignKey(
        'guest_admin_calls',
        new TableForeignKey({
          name: 'FK_guest_admin_calls_booking',
          columnNames: ['booking_id'],
          referencedTableName: 'bookings',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createCheckConstraint(
        'guest_admin_calls',
        new TableCheck({
          name: 'CHK_guest_admin_calls_status',
          expression: `status IN ('new', 'accepted', 'completed')`,
        }),
      );

      await queryRunner.createIndex(
        'guest_admin_calls',
        new TableIndex({
          name: 'IDX_guest_admin_calls_created_at',
          columnNames: ['created_at'],
        }),
      );

      await queryRunner.createIndex(
        'guest_admin_calls',
        new TableIndex({
          name: 'UQ_guest_admin_calls_active_booking',
          columnNames: ['booking_id'],
          isUnique: true,
          where: `status IN ('new', 'accepted')`,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('guest_admin_calls')) {
      await queryRunner.dropTable('guest_admin_calls', true, true, true);
    }
    if (await queryRunner.hasTable('booking_table_change_requests')) {
      await queryRunner.dropTable(
        'booking_table_change_requests',
        true,
        true,
        true,
      );
    }
  }
}
