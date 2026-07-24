import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateGuestRequestQueues1784850000000 implements MigrationInterface {
  name = 'CreateGuestRequestQueues1784850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('booking_table_change_requests');
    if (!hasTable) {
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
            { name: 'requested_table_number', type: 'varchar', length: '32', isNullable: true },
            { name: 'selected_table_id', type: 'uuid', isNullable: true },
            { name: 'status', type: 'varchar', length: '24', default: "'pending'" },
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

      await queryRunner.createIndex(
        'booking_table_change_requests',
        new TableIndex({
          name: 'IDX_booking_table_change_requests_status_created',
          columnNames: ['status', 'created_at'],
        }),
      );
    }

    const hasAcknowledgedAt = await queryRunner.hasColumn('guest_reviews', 'acknowledged_at');
    if (!hasAcknowledgedAt) {
      await queryRunner.query(
        'ALTER TABLE "guest_reviews" ADD COLUMN "acknowledged_at" timestamp NULL',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('guest_reviews', 'acknowledged_at')) {
      await queryRunner.query(
        'ALTER TABLE "guest_reviews" DROP COLUMN "acknowledged_at"',
      );
    }

    if (await queryRunner.hasTable('booking_table_change_requests')) {
      await queryRunner.dropTable('booking_table_change_requests', true, true, true);
    }
  }
}
