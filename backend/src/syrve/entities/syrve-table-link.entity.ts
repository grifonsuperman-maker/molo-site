import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { TableEntity } from '../../tables/entities/table.entity';
import { SyrveIntegration } from './syrve-integration.entity';

export type SyrveTableState = 'unknown' | 'open' | 'closed';

// Only the registered migration owns this schema, including in development.
@Entity({ name: 'syrve_table_links', synchronize: false })
@Unique('UQ_syrve_table_links_molo_table', ['moloTableId'])
@Unique('UQ_syrve_table_links_provider_table', ['organizationId', 'syrveTableId'])
@Check('CHK_syrve_table_links_state', '"last_syrve_state" IN (\'unknown\', \'open\', \'closed\')')
@Check('CHK_syrve_table_links_order_state', `
  ("last_syrve_state" = 'open' AND cardinality("active_syrve_order_ids") > 0)
  OR ("last_syrve_state" IN ('unknown', 'closed') AND cardinality("active_syrve_order_ids") = 0)
`)
@Check('CHK_syrve_table_links_order_ids', `
  (cardinality("active_syrve_order_ids") = 0 OR array_ndims("active_syrve_order_ids") = 1)
  AND (cardinality("manually_freed_syrve_order_ids") = 0 OR array_ndims("manually_freed_syrve_order_ids") = 1)
  AND array_position("active_syrve_order_ids", NULL) IS NULL
  AND array_position("manually_freed_syrve_order_ids", NULL) IS NULL
  AND "manually_freed_syrve_order_ids" <@ "active_syrve_order_ids"
`)
export class SyrveTableLink {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_syrve_table_links' })
  id: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'molo_table_id', type: 'uuid' })
  moloTableId: string;

  @Column({ name: 'syrve_table_id', type: 'uuid' })
  syrveTableId: string;

  // Informational only; identity is always the UUID pair.
  @Column({ name: 'last_known_number', type: 'integer' })
  lastKnownNumber: number;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_syrve_state', type: 'varchar', length: 16, default: 'unknown' })
  lastSyrveState: SyrveTableState;

  // PostgreSQL validates every ID. Multiple open orders can share one table.
  @Column({ name: 'active_syrve_order_ids', type: 'uuid', array: true, default: () => "'{}'::uuid[]" })
  activeSyrveOrderIds: string[];

  @Column({ name: 'manually_freed_syrve_order_ids', type: 'uuid', array: true, default: () => "'{}'::uuid[]" })
  manuallyFreedSyrveOrderIds: string[];

  // Parent deletion only removes this link; it never deletes a physical table.
  @ManyToOne(() => SyrveIntegration, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id', foreignKeyConstraintName: 'FK_syrve_table_links_integration' })
  integration: SyrveIntegration;

  @ManyToOne(() => TableEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'molo_table_id', foreignKeyConstraintName: 'FK_syrve_table_links_molo_table' })
  moloTable: TableEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
