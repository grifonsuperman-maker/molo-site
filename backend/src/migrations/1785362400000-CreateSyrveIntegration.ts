import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSyrveIntegration1785362400000 implements MigrationInterface {
  name = 'CreateSyrveIntegration1785362400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "syrve_integrations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "display_name" varchar(120) NOT NULL DEFAULT 'MOLO · Syrve',
        "api_base_url" text NOT NULL DEFAULT 'https://api-eu.syrve.live',
        "api_login_encrypted" text,
        "api_login_iv" varchar(64),
        "api_login_auth_tag" varchar(64),
        "api_login_masked" varchar(160),
        "organization_id" varchar(160),
        "organization_name" varchar(240),
        "status" varchar(32) NOT NULL DEFAULT 'not_connected',
        "last_checked_at" timestamp,
        "connected_at" timestamp,
        "last_error" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_syrve_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_syrve_integration_status" CHECK ("status" IN ('not_connected', 'connected', 'error'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "syrve_integrations"');
  }
}
