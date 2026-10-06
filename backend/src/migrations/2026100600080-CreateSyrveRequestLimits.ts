import { MigrationInterface, QueryRunner } from 'typeorm';

// Independent additive migration; neither synchronize nor application startup
// adopts it in production. Quota belongs to the API login, not its MOLO settings.
export class CreateSyrveRequestLimits2026100600080 implements MigrationInterface {
  name = 'CreateSyrveRequestLimits2026100600080';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "syrve_request_limits" (
      "key_hash" varchar(64) PRIMARY KEY,
      "next_request_at" timestamptz NOT NULL,
      CONSTRAINT "CHK_syrve_request_key_hash" CHECK ("key_hash" ~ '^[0-9a-f]{64}$')
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Syrve quota rollback requires an active transaction');
    await runner.query('LOCK TABLE "syrve_request_limits" IN ACCESS EXCLUSIVE MODE');
    const [row] = await runner.query('SELECT EXISTS (SELECT 1 FROM "syrve_request_limits" WHERE next_request_at>clock_timestamp()) AS active');
    if (row.active) throw new Error('Cannot reset a live Syrve quota or cooldown');
    await runner.query('DROP TABLE "syrve_request_limits"');
  }
}
