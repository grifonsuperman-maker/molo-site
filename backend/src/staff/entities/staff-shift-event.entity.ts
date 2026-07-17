import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Staff } from './staff.entity';

export type StaffShiftEventType =
  | 'shift_started'
  | 'shift_ended'
  | 'shift_auto_ended'
  | 'archived'
  | 'restored';

@Entity('staff_shift_events')
@Index(['staff', 'createdAt'])
export class StaffShiftEvent {
@PrimaryGeneratedColumn('uuid')
  id: string;

@ManyToOne(() => Staff, { nullable: false, onDelete: 'CASCADE', })
  staff: Staff;

@Column({ name: 'event_type', type: 'enum', enum: [ 'shift_started', 'shift_ended', 'shift_auto_ended', 'archived', 'restored', ], })
  eventType: StaffShiftEventType;

@Column({ name: 'performed_by', type: 'varchar', nullable: true })
  performedBy: string | null;

@Column({ type: 'text', nullable: true })
  comment: string | null;

@CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
