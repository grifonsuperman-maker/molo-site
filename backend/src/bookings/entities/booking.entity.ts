import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { TableEntity } from '../../tables/entities/table.entity';
import { Staff } from '../../staff/entities/staff.entity';

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
export type BookingSource = 'mini_app' | 'phone' | 'admin_manual';
export type CancelReason = 'guest_cancelled' | 'admin_cancelled' | 'no_show' | null;

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => TableEntity, (table) => table.bookings, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'table_id' })
  table: TableEntity | null;

  @ManyToOne(() => Client, (client) => client.bookings, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' })
  client: Client | null;

  @ManyToOne(() => Staff, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_staff_id' })
  createdByStaff: Staff | null;

  @Column({ name: 'booking_date', type: 'date' })
  bookingDate: string;

  @Column({ name: 'booking_time', type: 'time' })
  bookingTime: string;

  @Column({ name: 'duration_minutes', type: 'int', default: 120 })
  durationMinutes: number;

  @Column({ name: 'departure_time', type: 'time', nullable: true })
  departureTime: string | null;

  @Column({ name: 'cleanup_minutes', type: 'int', default: 15 })
  cleanupMinutes: number;

  @Column({ name: 'available_from', type: 'time', nullable: true })
  availableFrom: string | null;

  @Column({ name: 'arrival_grace_until', type: 'timestamp', nullable: true })
  arrivalGraceUntil: Date | null;

  @Column({ name: 'wait_extended_until', type: 'timestamp', nullable: true })
  waitExtendedUntil: Date | null;

  @Column({ name: 'wait_extended_count', type: 'int', default: 0 })
  waitExtendedCount: number;

  @Column({ name: 'checked_in_at', type: 'timestamp', nullable: true })
  checkedInAt: Date | null;

  @Column({ name: 'no_show_alert_sent_at', type: 'timestamp', nullable: true })
  noShowAlertSentAt: Date | null;

  @Column({ name: 'guests_count' })
  guestsCount: number;

  @Column({ type: 'text', nullable: true })
  wishes: string | null;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'completed'],
    default: 'pending',
  })
  status: BookingStatus;

  @Column({
    type: 'enum',
    enum: ['mini_app', 'phone', 'admin_manual'],
    default: 'mini_app',
  })
  source: BookingSource;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', nullable: true })
  cancelReason: CancelReason;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'late_notified_at', type: 'timestamp', nullable: true })
  lateNotifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
