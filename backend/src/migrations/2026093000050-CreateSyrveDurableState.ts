import { MigrationInterface, QueryRunner } from 'typeorm';

// Separate migration-owned storage: legacy entity reads need no new columns.
export class CreateSyrveDurableState2026093000050 implements MigrationInterface {
  name = 'CreateSyrveDurableState2026093000050';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "syrve_table_sync_states" (
      "link_id" uuid NOT NULL,
      "integration_id" uuid NOT NULL,
      "configuration_revision" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "molo_table_id" uuid NOT NULL,
      "syrve_table_id" uuid NOT NULL,
      "local_revision" uuid NOT NULL,
      CONSTRAINT "PK_syrve_table_sync_states" PRIMARY KEY ("link_id"),
      CONSTRAINT "FK_syrve_table_sync_states_link" FOREIGN KEY ("link_id")
        REFERENCES "syrve_table_links" ("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "syrve_order_versions" (
      "link_id" uuid NOT NULL,
      "order_id" uuid NOT NULL,
      "timestamp" bigint NOT NULL,
      "state" varchar(16) NOT NULL,
      "fingerprint" varchar(64),
      CONSTRAINT "PK_syrve_order_versions" PRIMARY KEY ("link_id", "order_id"),
      CONSTRAINT "FK_syrve_order_versions_state" FOREIGN KEY ("link_id")
        REFERENCES "syrve_table_sync_states" ("link_id") ON DELETE CASCADE,
      CONSTRAINT "CHK_syrve_order_versions_timestamp" CHECK ("timestamp" BETWEEN 0 AND 9007199254740991),
      CONSTRAINT "CHK_syrve_order_versions_outcome" CHECK ("state" IN ('open', 'closed', 'unknown')),
      CONSTRAINT "CHK_syrve_order_versions_fingerprint" CHECK (
        ("fingerprint" IS NULL AND "state" = 'unknown')
        OR ("fingerprint" IS NOT NULL AND "fingerprint" ~ '^[0-9a-f]{64}$'))
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) throw new Error('Syrve durable state rollback requires an active transaction');
    // A staff fence before the first order is valuable state too. Never discard
    // a ledger/override silently; an operator must separately retire the links.
    await queryRunner.query('LOCK TABLE "syrve_table_sync_states", "syrve_order_versions" IN ACCESS EXCLUSIVE MODE');
    const [row] = await queryRunner.query('SELECT EXISTS (SELECT 1 FROM "syrve_table_sync_states") AS present');
    if (row.present) throw new Error('Cannot roll back Syrve durable state while saved state exists');
    await queryRunner.query('DROP TABLE "syrve_order_versions"');
    await queryRunner.query('DROP TABLE "syrve_table_sync_states"');
  }
}
