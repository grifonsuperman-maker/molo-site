import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, MigrationExecutor, QueryRunner } from 'typeorm';

const MIGRATION_LOCK_NAMESPACE = 'molo';
const MIGRATION_LOCK_NAME = 'schema-migrations';

@Injectable()
export class StaffPinMigrationBootstrapService
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(StaffPinMigrationBootstrapService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_NAME],
      );

      const migrations = await this.executeRegisteredMigrations(queryRunner);
      await queryRunner.commitTransaction();

      if (migrations.length > 0) {
        this.logger.log(
          `Applied ${migrations.length} registered database migration(s)`,
        );
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  protected async executeRegisteredMigrations(queryRunner: QueryRunner) {
    const executor = new MigrationExecutor(this.dataSource, queryRunner);
    executor.transaction = 'none';
    return executor.executePendingMigrations();
  }
}
