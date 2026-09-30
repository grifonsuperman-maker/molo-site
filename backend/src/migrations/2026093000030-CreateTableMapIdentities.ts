import { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen physical catalog. Future map additions must use a new migration.
export class CreateTableMapIdentities2026093000030 implements MigrationInterface {
  name = 'CreateTableMapIdentities2026093000030';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      throw new Error('Physical map identity migration requires an active transaction');
    }
    await queryRunner.query("SET LOCAL lock_timeout = '750ms'");
    await queryRunner.query('LOCK TABLE "tables" IN SHARE MODE');
    await queryRunner.query(`
      CREATE TABLE "table_map_identities" (
        "table_id" uuid NOT NULL,
        "map_key" text NOT NULL,
        CONSTRAINT "PK_table_map_identities" PRIMARY KEY ("table_id"),
        CONSTRAINT "UQ_table_map_identities_map_key" UNIQUE ("map_key"),
        CONSTRAINT "FK_table_map_identities_table" FOREIGN KEY ("table_id")
          REFERENCES "tables" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_table_map_identities_map_key"
          CHECK ("map_key" IN ('hall:1', 'hall:2', 'hall:3', 'hall:4', 'hall:5', 'hall:6', 'hall:7', 'hall:8', 'hall:9', 'hall:10', 'hall:11', 'hall:12', 'hall:13', 'hall:14', 'canopy:15', 'canopy:16', 'canopy:17', 'canopy:18', 'canopy:19', 'canopy:20', 'gazebo:21', 'gazebo:22', 'gazebo:23', 'gazebo:24', 'gazebo:25', 'gazebo:26', 'gazebo:27', 'gazebo:28', 'gazebo:29', 'gazebo:30', 'gazebo:31', 'gazebo:32', 'gazebo:33', 'gazebo:34', 'gazebo:35', 'gazebo:36', 'rotang:37', 'rotang:38', 'rotang:39', 'embankment:40', 'embankment:41', 'embankment:42', 'embankment:43', 'embankment:44', 'glass_gazebo:45', 'glass_gazebo:46', 'glass_gazebo:47', 'glass_gazebo:48', 'glass_gazebo:49', 'glass_gazebo:50', 'water_gazebo:100', 'water_gazebo:101', 'water_gazebo:102', 'water_gazebo:103', 'water_gazebo:104', 'water_gazebo:105', 'water_gazebo:106', 'water_gazebo:107', 'water_gazebo:108', 'water_gazebo:109'))
      )
    `);
    await queryRunner.query(`
      WITH slots(number, map_key) AS (VALUES
          ('1', 'hall:1'), ('2', 'hall:2'), ('3', 'hall:3'), ('4', 'hall:4'), ('5', 'hall:5'), ('6', 'hall:6'), ('7', 'hall:7'), ('8', 'hall:8'), ('9', 'hall:9'), ('10', 'hall:10'), ('11', 'hall:11'), ('12', 'hall:12'), ('13', 'hall:13'), ('14', 'hall:14'),
          ('15', 'canopy:15'), ('16', 'canopy:16'), ('17', 'canopy:17'), ('18', 'canopy:18'), ('19', 'canopy:19'), ('20', 'canopy:20'),
          ('21', 'gazebo:21'), ('22', 'gazebo:22'), ('23', 'gazebo:23'), ('24', 'gazebo:24'), ('25', 'gazebo:25'), ('26', 'gazebo:26'), ('27', 'gazebo:27'), ('28', 'gazebo:28'), ('29', 'gazebo:29'), ('30', 'gazebo:30'), ('31', 'gazebo:31'), ('32', 'gazebo:32'), ('33', 'gazebo:33'), ('34', 'gazebo:34'), ('35', 'gazebo:35'), ('36', 'gazebo:36'),
          ('37', 'rotang:37'), ('38', 'rotang:38'), ('39', 'rotang:39'),
          ('40', 'embankment:40'), ('41', 'embankment:41'), ('42', 'embankment:42'), ('43', 'embankment:43'), ('44', 'embankment:44'),
          ('45', 'glass_gazebo:45'), ('46', 'glass_gazebo:46'), ('47', 'glass_gazebo:47'), ('48', 'glass_gazebo:48'), ('49', 'glass_gazebo:49'), ('50', 'glass_gazebo:50'),
          ('100', 'water_gazebo:100'), ('101', 'water_gazebo:101'), ('102', 'water_gazebo:102'), ('103', 'water_gazebo:103'), ('104', 'water_gazebo:104'), ('105', 'water_gazebo:105'), ('106', 'water_gazebo:106'), ('107', 'water_gazebo:107'), ('108', 'water_gazebo:108'), ('109', 'water_gazebo:109')
      ), normalized AS (
        SELECT "id", CASE WHEN btrim("table_number") ~ '^[0-9]{1,12}$'
          THEN CASE WHEN btrim("table_number")::numeric > 0
            THEN (btrim("table_number")::numeric)::text ELSE NULL END
          ELSE NULL END AS number
        FROM "tables"
      ), candidates AS (
        SELECT "id", number, count(*) OVER (PARTITION BY number) AS matches
        FROM normalized WHERE number IS NOT NULL
      )
      INSERT INTO "table_map_identities" ("table_id", "map_key")
      SELECT candidates."id", slots.map_key FROM candidates
      JOIN slots ON slots.number = candidates.number
      WHERE candidates.matches = 1
    `);
    await queryRunner.query(`
      CREATE FUNCTION "molo_keep_table_map_identity"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."table_id" IS DISTINCT FROM OLD."table_id"
          OR NEW."map_key" IS DISTINCT FROM OLD."map_key" THEN
          RAISE EXCEPTION 'Physical map identity cannot be reassigned'
            USING ERRCODE = '23514', CONSTRAINT = 'CHK_table_map_identity_immutable';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_table_map_identities_immutable"
      BEFORE UPDATE ON "table_map_identities"
      FOR EACH ROW EXECUTE FUNCTION "molo_keep_table_map_identity"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      throw new Error('Physical map identity rollback requires an active transaction');
    }
    const [state] = await queryRunner.query(
      "SELECT to_regclass('public.table_map_identities') IS NOT NULL AS present",
    );
    if (!state.present) return;
    await queryRunner.query("SET LOCAL lock_timeout = '750ms'");
    await queryRunner.query('LOCK TABLE "table_map_identities" IN ACCESS EXCLUSIVE MODE');
    const [rows] = await queryRunner.query(
      'SELECT EXISTS (SELECT 1 FROM "table_map_identities") AS "hasIdentities"',
    );
    if (rows.hasIdentities) {
      throw new Error('Cannot roll back physical map identity while binding records exist; retain and review them first');
    }
    await queryRunner.query('DROP TABLE "table_map_identities"');
    await queryRunner.query('DROP FUNCTION "molo_keep_table_map_identity"()');
  }
}
