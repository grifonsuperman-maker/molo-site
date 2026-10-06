import { MigrationInterface, QueryRunner } from 'typeorm';

// Explicit adoption only. Pending input, API logins and access tokens never
// enter this table; a crash expires the task and requires a fresh confirmation.
export class CreateSyrveOperations2026100700010 implements MigrationInterface {
  name = 'CreateSyrveOperations2026100700010';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "syrve_operations" (
      "id" uuid PRIMARY KEY, "owner_hash" varchar(64) NOT NULL,
      "runner_id" uuid NOT NULL, "kind" varchar(40) NOT NULL,
      "status" varchar(8) NOT NULL DEFAULT 'running',
      "started_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "expires_at" timestamptz NOT NULL, "live_until" timestamptz NOT NULL,
      "completed_at" timestamptz, "result" jsonb, "error" jsonb,
      CONSTRAINT "CHK_syrve_operation_owner" CHECK ("owner_hash" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_syrve_operation_status" CHECK ("status" IN ('running','done','failed'))
    )`);
    await runner.query(`CREATE UNIQUE INDEX "UQ_syrve_running_operation" ON "syrve_operations" ("owner_hash") WHERE "status"='running'`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Syrve operation rollback requires an active transaction');
    await runner.query('LOCK TABLE "syrve_operations" IN ACCESS EXCLUSIVE MODE');
    const [row] = await runner.query(`SELECT EXISTS (SELECT 1 FROM "syrve_operations" WHERE "status"='running' AND "live_until">clock_timestamp() AND "expires_at">clock_timestamp()) AS active`);
    if (row.active) throw new Error('Cannot remove live Syrve operations');
    await runner.query('DROP TABLE "syrve_operations"');
  }
}
