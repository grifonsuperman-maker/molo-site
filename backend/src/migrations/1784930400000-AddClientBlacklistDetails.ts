import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddClientBlacklistDetails1784930400000 implements MigrationInterface {
  name = 'AddClientBlacklistDetails1784930400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('clients');
    if (!table) return;

    if (!table.findColumnByName('blacklist_reason')) {
      await queryRunner.addColumn(
        'clients',
        new TableColumn({
          name: 'blacklist_reason',
          type: 'text',
          isNullable: true,
        }),
      );
    }

    if (!table.findColumnByName('blacklisted_at')) {
      await queryRunner.addColumn(
        'clients',
        new TableColumn({
          name: 'blacklisted_at',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('clients');
    if (!table) return;

    if (table.findColumnByName('blacklisted_at')) {
      await queryRunner.dropColumn('clients', 'blacklisted_at');
    }
    if (table.findColumnByName('blacklist_reason')) {
      await queryRunner.dropColumn('clients', 'blacklist_reason');
    }
  }
}
