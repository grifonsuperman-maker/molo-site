import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSyrveActivation2026100200070 implements MigrationInterface {
  name = 'CreateSyrveActivation2026100200070';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "syrve_sync_activation" (
      "integration_id" uuid PRIMARY KEY REFERENCES "syrve_integrations" ("id") ON DELETE CASCADE,
      "configuration_revision" uuid NOT NULL,
      "enabled" boolean NOT NULL DEFAULT false,
      "bindings_fingerprint" varchar(64),
      "loading_plan" jsonb,
      "actor_hash" varchar(64),
      "consented_at" timestamptz,
      CONSTRAINT "CHK_syrve_activation_hashes" CHECK (
        ("bindings_fingerprint" IS NULL OR "bindings_fingerprint" ~ '^[0-9a-f]{64}$') AND
        ("actor_hash" IS NULL OR "actor_hash" ~ '^[0-9a-f]{64}$')),
      CONSTRAINT "CHK_syrve_activation_consent" CHECK (NOT "enabled" OR (
        "bindings_fingerprint" IS NOT NULL AND "actor_hash" IS NOT NULL AND "consented_at" IS NOT NULL AND
        "loading_plan" IS NOT NULL AND jsonb_typeof("loading_plan") = 'object'))
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Syrve activation rollback requires an active transaction');
    await runner.query('LOCK TABLE "syrve_sync_activation" IN ACCESS EXCLUSIVE MODE');
    const [row] = await runner.query('SELECT EXISTS (SELECT 1 FROM "syrve_sync_activation") AS present');
    if (row.present) throw new Error('Cannot roll back Syrve activation while saved consent exists');
    await runner.query('DROP TABLE "syrve_sync_activation"');
  }
}
