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
    let lockAcquired = false;

    await queryRunner.connect();
    try {
      await queryRunner.query(
        'SELECT pg_advisory_lock(hashtext($1), hashtext($2))',
        [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_NAME],
      );
      lockAcquired = true;

      const migrations = await this.executeRegisteredMigrations(queryRunner);

      if (migrations.length > 0) {
        this.logger.log(
          `Applied ${migrations.length} registered database migration(s)`,
        );
      }
    } finally {
      if (lockAcquired) {
        try {
          await queryRunner.query(
            'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
            [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_NAME],
          );
        } catch (error) {
          this.logger.error(
            'Failed to explicitly release migration advisory lock; the database connection release will clear it',
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      await queryRunner.release();
    }
  }

  protected async executeRegisteredMigrations(queryRunner: QueryRunner) {
    const executor = new MigrationExecutor(this.dataSource, queryRunner);
    executor.transaction = 'all';
    return executor.executePendingMigrations();
  }
}
