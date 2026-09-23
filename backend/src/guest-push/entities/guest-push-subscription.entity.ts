import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Booking } from '../../bookings/entities/booking.entity';

@Entity({ name: 'guest_push_subscriptions', synchronize: false })
export class GuestPushSubscription {
  @PrimaryColumn({
    name: 'booking_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_guest_push_subscriptions',
  })
  bookingId: string;

  @PrimaryColumn({
    name: 'endpoint_hash',
    type: 'varchar',
    length: 64,
    primaryKeyConstraintName: 'PK_guest_push_subscriptions',
  })
  endpointHash: string;

  @Column({
    name: 'guest_device_id_hash',
    type: 'varchar',
    length: 64,
  })
  guestDeviceIdHash: string;

  @Column({ type: 'text' })
  endpoint: string;

  @Column({ type: 'text' })
  p256dh: string;

  @Column({ type: 'text' })
  auth: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
  })
  updatedAt: Date;

  @ManyToOne(() => Booking, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'booking_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_guest_push_subscriptions_booking',
  })
  booking: Booking;
}
