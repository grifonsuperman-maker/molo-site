import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Booking } from '../../bookings/entities/booking.entity';

export type WaiterCallStatus = 'new' | 'accepted' | 'closed';

@Entity({ name: 'waiter_calls', synchronize: false })
@Check('CHK_waiter_calls_status', `"status" IN ('new', 'accepted', 'closed')`)
@Index('IDX_waiter_calls_status_created_at', ['status', 'createdAt'])
@Index('IDX_waiter_calls_waiter_status', ['waiterId', 'status'])
@Index('UQ_waiter_calls_active_booking', ['booking'], {
  unique: true,
  where: `"status" IN ('new', 'accepted')`,
})
export class WaiterCallRecord {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  id: string;

  @ManyToOne(() => Booking, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'FK_waiter_calls_booking',
  })
  booking: Booking;

  @Column({ name: 'table_id', type: 'uuid', nullable: true })
  tableId: string | null;

  @Column({ name: 'table_number', type: 'varchar', length: 32, nullable: true })
  tableNumber: string | null;

  @Column({ name: 'client_name', type: 'varchar', length: 160, nullable: true })
  clientName: string | null;

  @Column({ name: 'waiter_id', type: 'uuid', nullable: true })
  waiterId: string | null;

  @Column({ name: 'waiter_name', type: 'varchar', length: 160, nullable: true })
  waiterName: string | null;

  @Column({ type: 'varchar', length: 16, default: 'new' })
  status: WaiterCallStatus;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
