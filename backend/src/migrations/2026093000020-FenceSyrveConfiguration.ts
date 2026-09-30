import { MigrationInterface, QueryRunner } from 'typeorm';

export class FenceSyrveConfiguration2026093000020 implements MigrationInterface {
  name = 'FenceSyrveConfiguration2026093000020';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Syrve configuration migration requires an active transaction');
    await runner.query('LOCK TABLE "syrve_integrations" IN ACCESS EXCLUSIVE MODE');
    const [state] = await runner.query('SELECT count(*)::int AS count FROM "syrve_integrations"');
    if (state.count > 1) throw new Error('Syrve singleton requires an audited reconciliation of duplicate configurations; no records were removed');
    await runner.query('ALTER TABLE "syrve_integrations" ADD COLUMN "configuration_revision" uuid NOT NULL DEFAULT gen_random_uuid()');
    await runner.query('CREATE UNIQUE INDEX "UQ_syrve_integrations_singleton" ON "syrve_integrations" ((1))');
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Syrve configuration rollback requires an active transaction');
    await runner.query('LOCK TABLE "syrve_integrations", "syrve_table_links" IN ACCESS EXCLUSIVE MODE');
    const [state] = await runner.query('SELECT EXISTS (SELECT 1 FROM "syrve_table_links") AS "hasLinks"');
    if (state.hasLinks) throw new Error('Cannot remove Syrve configuration fencing while confirmed mappings exist');
    // Preserve every settings/credential row. A later up generates fresh UUIDs,
    // so a receipt issued before rollback can never become valid again (ABA).
    await runner.query('DROP INDEX "UQ_syrve_integrations_singleton"');
    await runner.query('ALTER TABLE "syrve_integrations" DROP COLUMN "configuration_revision"');
  }
}
