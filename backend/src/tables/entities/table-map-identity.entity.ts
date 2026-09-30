import { Column, Entity, PrimaryColumn } from 'typeorm';

// Independent of removable Syrve links. Only the migration writes identities.
// Existing TableEntity remains compatible with an unprepared production schema.
@Entity({ name: 'table_map_identities', synchronize: false })
export class TableMapIdentity {
  @PrimaryColumn({ name: 'table_id', type: 'uuid' })
  tableId: string;

  @Column({ name: 'map_key', type: 'text' })
  mapKey: string;
}
