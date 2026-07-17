import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { TableEntity } from '../../tables/entities/table.entity';

export type HookahCallStatus =
  | 'new'
  | 'accepted'
  | 'completed'
  | 'cancelled';

@Entity('hookah_calls')
@Index(['booking', 'status'])
@Index(['status', 'createdAt'])
export class HookahCall {
@PrimaryGeneratedColumn('uuid')
  id: string;

@ManyToOne(() => Booking, { nullable: false, onDelete: 'CASCADE', })
@JoinColumn({ name: 'booking_id' })
  booking: Booking;

@ManyToOne(() => TableEntity, { nullable: true, onDelete: 'SET NULL', })
@JoinColumn({ name: 'table_id' })
  table: TableEntity | null;

@ManyToOne(() => Staff, { nullable: true, onDelete: 'SET NULL', })
@JoinColumn({ name: 'accepted_by_staff_id' })
  acceptedByStaff: Staff | null;

@Column({ type: 'varchar', length: 20, default: 'new', })
  status: HookahCallStatus;

@Column({ name: 'eta_minutes', type: 'integer', nullable: true, })
  etaMinutes: number | null;

@Column({ name: 'accepted_at', type: 'timestamp', nullable: true, })
  acceptedAt: Date | null;

@Column({ name: 'completed_at', type: 'timestamp', nullable: true, })
  completedAt: Date | null;

@Column({ name: 'cancelled_at', type: 'timestamp', nullable: true, })
  cancelledAt: Date | null;

@Column({ name: 'cancel_reason', type: 'text', nullable: true, })
  cancelReason: string | null;

@CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

@UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
