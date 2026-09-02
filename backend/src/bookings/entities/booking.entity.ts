import {
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { TableEntity } from '../../tables/entities/table.entity';

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
export type BookingSource = 'mini_app' | 'phone' | 'admin_manual';

export interface GuestBookingNotification {
  type: 'manual_change' | 'no_show' | 'lateness_overdue' | 'booking_updated' | 'reschedule_decision';
  title: string;
  message?: string;
  reason?: string;
  decision?: 'approved' | 'rejected';
  previousTableNumber?: string | null;
  newTableNumber?: string | null;
  createdAt: string;
  acknowledgedAt?: string | null;
}

@Index('IDX_bookings_guest_device_id_hash', ['guestDeviceIdHash'])
@Index(
  'UQ_bookings_active_guest_device_date',
  ['bookingDate', 'guestDeviceIdHash'],
  {
    unique: true,
    where:
      `"guest_device_id_hash" IS NOT NULL AND "status" IN ('pending', 'approved')`,
  },
)
@Index(
  'UQ_bookings_active_guest_phone_date',
  ['bookingDate', 'guestPhoneNormalized'],
  {
    unique: true,
    where:
      `"guest_phone_normalized" IS NOT NULL AND "status" IN ('pending', 'approved')`,
  },
)
@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TableEntity, (table) => table.bookings, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'table_id' })
  table: TableEntity | null;

  @ManyToOne(() => Client, (client) => client.bookings, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'client_id' })
  client: Client | null;

  @ManyToOne(() => Staff, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by_staff_id' })
  createdByStaff: Staff | null;

  /** У базі зберігається тільки SHA-256 hash. Відкритий токен повертається гостю один раз. */
  @Index({ unique: true })
  @Column({
    name: 'guest_access_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  guestAccessTokenHash: string | null;

  @Column({
    name: 'guest_device_id_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  guestDeviceIdHash: string | null;

  @Column({
    name: 'guest_phone_normalized',
    type: 'varchar',
    length: 32,
    nullable: true,
    select: false,
  })
  guestPhoneNormalized: string | null;

  /** Ім'я, введене Адміністратором саме для ручного бронювання. */
  @Column({
    name: 'guest_name',
    type: 'text',
    nullable: true,
  })
  guestName: string | null;

  @Column({
    name: 'booking_date',
    type: 'date',
  })
  bookingDate: string;

  @Column({
    name: 'booking_time',
    type: 'time',
  })
  bookingTime: string;

  /** Nullable для сумісності зі старими бронюваннями, де тривалість записана у wishes. */
  @Column({
    name: 'duration_minutes',
    type: 'integer',
    nullable: true,
  })
  durationMinutes: number | null;

  @Column({
    name: 'guests_count',
  })
  guestsCount: number;

  @Column({
    type: 'text',
    nullable: true,
  })
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

  @Column({
    name: 'approved_at',
    type: 'timestamp',
    nullable: true,
  })
  approvedAt: Date | null;

  @Column({
    name: 'rejected_at',
    type: 'timestamp',
    nullable: true,
  })
  rejectedAt: Date | null;

  @Column({
    name: 'cancelled_at',
    type: 'timestamp',
    nullable: true,
  })
  cancelledAt: Date | null;

  @Column({
    name: 'cancellation_reason',
    type: 'text',
    nullable: true,
  })
  cancellationReason: string | null;

  @Column({
    name: 'completed_at',
    type: 'timestamp',
    nullable: true,
  })
  completedAt: Date | null;

  @Column({
    name: 'checked_in_at',
    type: 'timestamp',
    nullable: true,
  })
  checkedInAt: Date | null;

  @Column({
    name: 'late_notified_at',
    type: 'timestamp',
    nullable: true,
  })
  lateNotifiedAt: Date | null;

  @Column({
    name: 'lateness_hours',
    type: 'integer',
    nullable: true,
  })
  latenessHours: number | null;

  @Column({
    name: 'lateness_minutes',
    type: 'integer',
    nullable: true,
  })
  latenessMinutes: number | null;

  @Column({
    name: 'expected_arrival_at',
    type: 'timestamp',
    nullable: true,
  })
  expectedArrivalAt: Date | null;

  @Column({
    name: 'guest_notification',
    type: 'jsonb',
    nullable: true,
  })
  guestNotification: GuestBookingNotification | null;

  @Column({
    name: 'manual_change_reason',
    type: 'text',
    nullable: true,
  })
  manualChangeReason: string | null;

  @Column({
    name: 'manually_changed_at',
    type: 'timestamp',
    nullable: true,
  })
  manuallyChangedAt: Date | null;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
  })
  updatedAt: Date;

  @AfterLoad()
  useBookingSpecificManualGuestName() {
    if (this.source === 'admin_manual' && this.guestName && this.client) {
      this.client = {
        ...this.client,
        fullName: this.guestName,
      } as Client;
    }
  }
}
