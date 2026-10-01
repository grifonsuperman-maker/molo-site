import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSyrveWorkerState2026100100060 implements MigrationInterface {
  name = 'CreateSyrveWorkerState2026100100060';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "syrve_worker_state" (
      "integration_id" uuid NOT NULL PRIMARY KEY REFERENCES "syrve_integrations" ("id") ON DELETE CASCADE,
      "configuration_revision" uuid NOT NULL,
      "lease_id" uuid,
      "lease_until" timestamptz,
      "failure_count" integer NOT NULL DEFAULT 0 CHECK ("failure_count" BETWEEN 0 AND 20),
      "next_attempt_at" timestamptz NOT NULL DEFAULT '-infinity',
      "last_attempt_at" timestamptz,
      "last_success_at" timestamptz,
      "last_error_code" varchar(64),
      "cursor_link_id" uuid REFERENCES "syrve_table_links" ("id") ON DELETE SET NULL,
      CONSTRAINT "CHK_syrve_worker_lease" CHECK (("lease_id" IS NULL) = ("lease_until" IS NULL)),
      CONSTRAINT "CHK_syrve_worker_error" CHECK ("last_error_code" IS NULL OR "last_error_code" IN (
        'SYRVE_AUTH_FAILED','SYRVE_ACCESS_DENIED','SYRVE_RATE_LIMITED','SYRVE_TIMEOUT','SYRVE_UNAVAILABLE',
        'SYRVE_INVALID_RESPONSE','SYRVE_ORGANIZATION_UNAVAILABLE','SYRVE_OBSERVATION_LIMIT',
        'SYRVE_OBSERVATION_UNKNOWN','SYRVE_CONFIGURATION_CHANGED','SYRVE_LOCAL_STATE_CHANGED','SYRVE_STATE_INVALID'))
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) throw new Error('Syrve worker rollback requires an active transaction');
    await queryRunner.query('LOCK TABLE "syrve_worker_state" IN ACCESS EXCLUSIVE MODE');
    const [state] = await queryRunner.query('SELECT EXISTS (SELECT 1 FROM "syrve_worker_state") AS present');
    if (state.present) throw new Error('Cannot roll back Syrve worker while saved worker state exists');
    await queryRunner.query('DROP TABLE "syrve_worker_state"');
  }
}
