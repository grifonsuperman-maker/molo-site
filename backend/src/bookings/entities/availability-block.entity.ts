import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { TableEntity } from '../../tables/entities/table.entity';
import { Zone } from '../../zones/entities/zone.entity';

@Entity('availability_blocks')
@Index('IDX_availability_blocks_date', ['blockDate'])
@Check(
  'CHK_availability_blocks_single_target',
  '((table_id IS NOT NULL AND zone_id IS NULL) OR (table_id IS NULL AND zone_id IS NOT NULL))',
)
export class AvailabilityBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TableEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'table_id' })
  table: TableEntity | null;

  @ManyToOne(() => Zone, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zone_id' })
  zone: Zone | null;

  @Column({ name: 'block_date', type: 'date' })
  blockDate: string;

  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;

  @Column({ type: 'text' })
  reason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
