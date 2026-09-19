import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Zone } from '../../zones/entities/zone.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { Staff } from '../../staff/entities/staff.entity';

export type TableStatus = 'free' | 'pending' | 'reserved' | 'occupied' | 'cleaning' | 'closed';

@Index('IDX_tables_assigned_waiter', ['assignedWaiterId'])
@Entity('tables')
export class TableEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Zone, (zone) => zone.tables, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone: Zone | null;

  @Column({ name: 'table_number' })
  tableNumber: string;

  @Column({ default: 4 })
  seats: number;

  @Column({ default: 'rectangle' })
  shape: string;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl: string | null;

  @Column({
    type: 'enum',
    enum: ['free', 'pending', 'reserved', 'occupied', 'cleaning', 'closed'],
    default: 'free',
  })
  status: TableStatus;

  /** Durable assignment shared by site and Telegram; null means no waiter owns this table. */
  @Column({ name: 'assigned_waiter_id', type: 'uuid', nullable: true })
  assignedWaiterId: string | null;

  // Keep the migration's FK in TypeORM metadata; synchronization must not remove ON DELETE SET NULL.
  @ManyToOne(() => Staff, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_waiter_id', referencedColumnName: 'id', foreignKeyConstraintName: 'FK_tables_assigned_waiter' })
  assignedWaiter: Staff | null;

  @Column({ type: 'numeric', default: 0 })
  x: number;

  @Column({ type: 'numeric', default: 0 })
  y: number;

  @Column({ type: 'numeric', default: 100 })
  width: number;

  @Column({ type: 'numeric', default: 80 })
  height: number;

  @Column({ type: 'numeric', default: 0 })
  rotation: number;

  @Column({ name: 'is_visible', default: true })
  isVisible: boolean;

  @OneToMany(() => Booking, (booking) => booking.table)
  bookings: Booking[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
