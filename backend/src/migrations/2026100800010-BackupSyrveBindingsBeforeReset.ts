import { MigrationInterface, QueryRunner } from 'typeorm';

// An operator can restore mappings/ledger state after a deliberate reset.
// Credentials are never captured; the backup survives a disconnected integration.
export class BackupSyrveBindingsBeforeReset2026100800010 implements MigrationInterface {
  name = 'BackupSyrveBindingsBeforeReset2026100800010';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "syrve_binding_reset_backups" (
      "id" uuid PRIMARY KEY,
      "integration_id" uuid NOT NULL,
      "organization_id" uuid,
      "configuration_revision" uuid NOT NULL,
      "saved_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "link_count" integer NOT NULL CHECK ("link_count" BETWEEN 1 AND 1000),
      "snapshot" jsonb NOT NULL,
      CONSTRAINT "CHK_syrve_binding_backup_shape" CHECK (
        jsonb_typeof("snapshot") = 'object'
        AND jsonb_typeof("snapshot"->'links') = 'array'
        AND jsonb_typeof("snapshot"->'sync_states') = 'array'
        AND jsonb_typeof("snapshot"->'order_versions') = 'array'
        AND jsonb_typeof("snapshot"->'activation') = 'array'
        AND jsonb_typeof("snapshot"->'worker') = 'array'
        AND jsonb_array_length("snapshot"->'links') = "link_count")
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Syrve backup rollback requires an active transaction');
    await runner.query('LOCK TABLE "syrve_binding_reset_backups" IN ACCESS EXCLUSIVE MODE');
    const [row] = await runner.query('SELECT EXISTS (SELECT 1 FROM "syrve_binding_reset_backups") AS saved');
    if (row.saved) throw new Error('Cannot discard Syrve reset backups; export and restore or archive them first');
    await runner.query('DROP TABLE "syrve_binding_reset_backups"');
  }
}
