import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { TableEntity } from '../../tables/entities/table.entity';
import { Booking } from './booking.entity';

export type BookingTableChangeRequestStatus = 'pending' | 'approved' | 'rejected';

@Entity('booking_table_change_requests')
export class BookingTableChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Booking, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'requested_table_number', type: 'varchar', length: 32, nullable: true })
  requestedTableNumber: string | null;

  @ManyToOne(() => TableEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_table_id' })
  approvedTable: TableEntity | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: BookingTableChangeRequestStatus;

  @Column({ name: 'admin_comment', type: 'text', nullable: true })
  adminComment: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
