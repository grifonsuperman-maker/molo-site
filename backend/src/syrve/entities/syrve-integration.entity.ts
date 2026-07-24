import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SyrveIntegrationStatus = 'not_connected' | 'connected' | 'error';

@Entity('syrve_integrations')
export class SyrveIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120, default: 'MOLO · Syrve' })
  displayName: string;

  @Column({ name: 'api_base_url', type: 'text', default: 'https://api-eu.syrve.live' })
  apiBaseUrl: string;

  @Column({ name: 'api_login_encrypted', type: 'text', nullable: true })
  apiLoginEncrypted: string | null;

  @Column({ name: 'api_login_iv', type: 'varchar', length: 64, nullable: true })
  apiLoginIv: string | null;

  @Column({ name: 'api_login_auth_tag', type: 'varchar', length: 64, nullable: true })
  apiLoginAuthTag: string | null;

  @Column({ name: 'api_login_masked', type: 'varchar', length: 160, nullable: true })
  apiLoginMasked: string | null;

  @Column({ name: 'organization_id', type: 'varchar', length: 160, nullable: true })
  organizationId: string | null;

  @Column({ name: 'organization_name', type: 'varchar', length: 240, nullable: true })
  organizationName: string | null;

  @Column({ type: 'varchar', length: 32, default: 'not_connected' })
  status: SyrveIntegrationStatus;

  @Column({ name: 'last_checked_at', type: 'timestamp', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ name: 'connected_at', type: 'timestamp', nullable: true })
  connectedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
