import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { TableEntity } from '../../tables/entities/table.entity';
import { Staff } from '../../staff/entities/staff.entity';
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
export type BookingSource = 'mini_app' | 'phone' | 'admin_manual';
@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => TableEntity, (table) => table.bookings, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'table_id' }) table: TableEntity | null;
  @ManyToOne(() => Client, (client) => client.bookings, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' }) client: Client | null;
  @ManyToOne(() => Staff, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_staff_id' }) createdByStaff: Staff | null;
  @Column({ name: 'booking_date', type: 'date' }) bookingDate: string;
  @Column({ name: 'booking_time', type: 'time' }) bookingTime: string;
  @Column({ name: 'guests_count' }) guestsCount: number;
  @Column({ type: 'text', nullable: true }) wishes: string | null;
  @Column({ type: 'enum', enum: ['pending', 'approved', 'rejected', 'cancelled', 'completed'], default: 'pending' }) status: BookingStatus;
  @Column({ type: 'enum', enum: ['mini_app', 'phone', 'admin_manual'], default: 'mini_app' }) source: BookingSource;
  @Column({ name: 'approved_at', type: 'timestamp', nullable: true }) approvedAt: Date | null;
  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true }) rejectedAt: Date | null;
  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true }) cancelledAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true }) completedAt: Date | null;
  @Column({ name: 'late_notified_at', type: 'timestamp', nullable: true }) lateNotifiedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
