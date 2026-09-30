import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSyrveTableLinks2026093000010 implements MigrationInterface {
  name = 'CreateSyrveTableLinks2026093000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    // No tables, bookings, credentials or existing integration rows are modified.
    await queryRunner.query(`
      CREATE TABLE "syrve_table_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "integration_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "molo_table_id" uuid NOT NULL,
        "syrve_table_id" uuid NOT NULL,
        "last_known_number" integer NOT NULL,
        "last_seen_at" timestamp with time zone,
        "last_synced_at" timestamp with time zone,
        "last_syrve_state" character varying(16) NOT NULL DEFAULT 'unknown',
        "active_syrve_order_ids" uuid[] NOT NULL DEFAULT '{}',
        "manually_freed_syrve_order_ids" uuid[] NOT NULL DEFAULT '{}',
        "created_at" timestamp without time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp without time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_syrve_table_links" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_syrve_table_links_molo_table" UNIQUE ("molo_table_id"),
        CONSTRAINT "UQ_syrve_table_links_provider_table" UNIQUE ("organization_id", "syrve_table_id"),
        CONSTRAINT "FK_syrve_table_links_integration"
          FOREIGN KEY ("integration_id") REFERENCES "syrve_integrations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_syrve_table_links_molo_table"
          FOREIGN KEY ("molo_table_id") REFERENCES "tables" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_syrve_table_links_state"
          CHECK ("last_syrve_state" IN ('unknown', 'open', 'closed')),
        CONSTRAINT "CHK_syrve_table_links_order_state" CHECK (
          ("last_syrve_state" = 'open' AND cardinality("active_syrve_order_ids") > 0)
          OR ("last_syrve_state" IN ('unknown', 'closed') AND cardinality("active_syrve_order_ids") = 0)
        ),
        CONSTRAINT "CHK_syrve_table_links_order_ids" CHECK (
          (cardinality("active_syrve_order_ids") = 0 OR array_ndims("active_syrve_order_ids") = 1)
          AND (cardinality("manually_freed_syrve_order_ids") = 0 OR array_ndims("manually_freed_syrve_order_ids") = 1)
          AND array_position("active_syrve_order_ids", NULL) IS NULL
          AND array_position("manually_freed_syrve_order_ids", NULL) IS NULL
          AND "manually_freed_syrve_order_ids" <@ "active_syrve_order_ids"
        )
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      throw new Error('Syrve table link rollback requires an active transaction');
    }
    const [table] = await queryRunner.query(`
      SELECT to_regclass('public.syrve_table_links') IS NOT NULL AS "present"
    `);
    if (!table?.present) return;

    // Prevent a concurrent mapping from being lost between the check and DROP.
    await queryRunner.query('LOCK TABLE "syrve_table_links" IN ACCESS EXCLUSIVE MODE');
    const [state] = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM "syrve_table_links") AS "hasLinks"
    `);
    if (state?.hasLinks) {
      throw new Error('Cannot revert Syrve table links while mapping records exist');
    }
    await queryRunner.query('DROP TABLE "syrve_table_links"');
  }
}
