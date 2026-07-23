import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateAvailabilityBlocks1784844000000 implements MigrationInterface {
  name = 'CreateAvailabilityBlocks1784844000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('availability_blocks');
    if (hasTable) return;

    await queryRunner.createTable(
      new Table({
        name: 'availability_blocks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'table_id', type: 'uuid', isNullable: true },
          { name: 'zone_id', type: 'uuid', isNullable: true },
          { name: 'block_date', type: 'date' },
          { name: 'start_time', type: 'time', isNullable: true },
          { name: 'end_time', type: 'time', isNullable: true },
          { name: 'reason', type: 'text' },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKeys('availability_blocks', [
      new TableForeignKey({
        name: 'FK_availability_blocks_table',
        columnNames: ['table_id'],
        referencedTableName: 'tables',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        name: 'FK_availability_blocks_zone',
        columnNames: ['zone_id'],
        referencedTableName: 'zones',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ]);

    await queryRunner.createIndex(
      'availability_blocks',
      new TableIndex({
        name: 'IDX_availability_blocks_date',
        columnNames: ['block_date'],
      }),
    );

    await queryRunner.createCheckConstraint(
      'availability_blocks',
      new TableCheck({
        name: 'CHK_availability_blocks_single_target',
        expression:
          '((table_id IS NOT NULL AND zone_id IS NULL) OR (table_id IS NULL AND zone_id IS NOT NULL))',
      }),
    );

    await queryRunner.createCheckConstraint(
      'availability_blocks',
      new TableCheck({
        name: 'CHK_availability_blocks_time_pair',
        expression:
          '((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time))',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('availability_blocks');
    if (!hasTable) return;
    await queryRunner.dropTable('availability_blocks', true, true, true);
  }
}
