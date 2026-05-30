import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Booking, BookingStatus } from './booking.entity';
@Entity('booking_reschedule_requests')
export class BookingRescheduleRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Booking, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' }) booking: Booking;
  @Column({ name: 'requested_date', type: 'date' }) requestedDate: string;
  @Column({ name: 'requested_time', type: 'time' }) requestedTime: string;
  @Column({ type: 'enum', enum: ['pending', 'approved', 'rejected', 'cancelled', 'completed'], default: 'pending' }) status: BookingStatus;
  @Column({ name: 'admin_comment', type: 'text', nullable: true }) adminComment: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true }) resolvedAt: Date | null;
}
