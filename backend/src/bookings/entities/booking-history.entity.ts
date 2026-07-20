import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Booking } from './booking.entity';

@Entity('booking_history')
export class BookingHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Booking, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 40, nullable: true })
  actorRole: string | null;

  @Column({ name: 'actor_staff_id', type: 'uuid', nullable: true })
  actorStaffId: string | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160, nullable: true })
  actorName: string | null;

  @Column({ name: 'previous_data', type: 'jsonb', nullable: true })
  previousData: Record<string, unknown> | null;

  @Column({ name: 'new_data', type: 'jsonb', nullable: true })
  newData: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'is_manual_mode', default: false })
  isManualMode: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
