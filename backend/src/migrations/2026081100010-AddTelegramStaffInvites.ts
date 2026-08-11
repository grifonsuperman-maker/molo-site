import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelegramStaffInvites2026081100010 implements MigrationInterface {
  name = 'AddTelegramStaffInvites2026081100010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "telegram_invite_token_hash" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "telegram_invite_expires_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff" DROP COLUMN IF EXISTS "telegram_invite_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff" DROP COLUMN IF EXISTS "telegram_invite_token_hash"`,
    );
  }
}
