import { QueryRunner } from 'typeorm';

export async function assertNoPublicTextSearchCatalogObjects(
  queryRunner: QueryRunner,
): Promise<void> {
  const objects = await queryRunner.query(`
    SELECT object_kind, object_name
    FROM (
      SELECT
        'text_search_configuration'::text AS object_kind,
        config_namespace.nspname || '.' || config_row.cfgname AS object_name
      FROM pg_ts_config AS config_row
      JOIN pg_namespace AS config_namespace
        ON config_namespace.oid = config_row.cfgnamespace
      WHERE config_namespace.nspname = 'public'

      UNION ALL

      SELECT
        'text_search_dictionary'::text AS object_kind,
        dict_namespace.nspname || '.' || dict_row.dictname AS object_name
      FROM pg_ts_dict AS dict_row
      JOIN pg_namespace AS dict_namespace
        ON dict_namespace.oid = dict_row.dictnamespace
      WHERE dict_namespace.nspname = 'public'

      UNION ALL

      SELECT
        'text_search_parser'::text AS object_kind,
        parser_namespace.nspname || '.' || parser_row.prsname AS object_name
      FROM pg_ts_parser AS parser_row
      JOIN pg_namespace AS parser_namespace
        ON parser_namespace.oid = parser_row.prsnamespace
      WHERE parser_namespace.nspname = 'public'

      UNION ALL

      SELECT
        'text_search_template'::text AS object_kind,
        template_namespace.nspname || '.' || template_row.tmplname AS object_name
      FROM pg_ts_template AS template_row
      JOIN pg_namespace AS template_namespace
        ON template_namespace.oid = template_row.tmplnamespace
      WHERE template_namespace.nspname = 'public'
    ) AS public_text_search_objects
    ORDER BY object_kind, object_name
  `);

  if (objects.length > 0) {
    const preview = objects
      .slice(0, 8)
      .map(
        (row: { object_kind: string; object_name: string }) =>
          `${row.object_kind}:${row.object_name}`,
      )
      .join(', ');
    throw new Error(
      `Database contains public text-search catalog objects outside the approved initial baseline: ${preview}`,
    );
  }
}
