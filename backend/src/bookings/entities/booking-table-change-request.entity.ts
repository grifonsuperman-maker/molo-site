import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Booking } from './booking.entity';

export type BookingTableChangeRequestStatus = 'pending' | 'approved' | 'rejected';

@Entity('booking_table_change_requests')
export class BookingTableChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Booking, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'requested_table_number', type: 'varchar', length: 64, nullable: true })
  requestedTableNumber: string | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: BookingTableChangeRequestStatus;

  @Column({ name: 'admin_comment', type: 'text', nullable: true })
  adminComment: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
