import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type StaffRole = 'owner' | 'admin' | 'waiter' | 'hookah';

@Entity('staff')
export class Staff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'telegram_id',
    type: 'bigint',
    nullable: true,
    unique: true,
  })
  telegramId: string | null;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ nullable: true })
  phone: string | null;

  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'waiter', 'hookah'],
    default: 'waiter',
  })
  role: StaffRole;

  @Column({ name: 'pin_hash', type: 'text', nullable: true })
  pinHash: string | null;

  @Column({
    name: 'director_login_name',
    type: 'varchar',
    length: 64,
    nullable: true,
    unique: true,
  })
  directorLoginName: string | null;

  @Column({ name: 'director_password_hash', type: 'text', nullable: true })
  directorPasswordHash: string | null;

  @Column({
    name: 'director_credentials_configured_at',
    type: 'timestamp',
    nullable: true,
  })
  directorCredentialsConfiguredAt: Date | null;

  @Column({
    name: 'director_failed_login_attempts',
    type: 'integer',
    default: 0,
  })
  directorFailedLoginAttempts: number;

  @Column({ name: 'director_locked_until', type: 'timestamp', nullable: true })
  directorLockedUntil: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'is_archived', default: false })
  isArchived: boolean;

  @Column({ name: 'is_on_shift', default: false })
  isOnShift: boolean;

  @Column({ name: 'shift_started_at', type: 'timestamp', nullable: true })
  shiftStartedAt: Date | null;

  @Column({ name: 'shift_started_by', type: 'varchar', nullable: true })
  shiftStartedBy: string | null;

  @Column({ name: 'shift_ended_at', type: 'timestamp', nullable: true })
  shiftEndedAt: Date | null;

  @Column({ name: 'shift_ended_by', type: 'varchar', nullable: true })
  shiftEndedBy: string | null;

  @Column({ name: 'last_auto_shift_end_date', type: 'date', nullable: true })
  lastAutoShiftEndDate: string | null;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'archived_by', type: 'varchar', nullable: true })
  archivedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
