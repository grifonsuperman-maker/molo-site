import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Zone } from '../../zones/entities/zone.entity';
import { Booking } from '../../bookings/entities/booking.entity';
export type TableStatus = 'free' | 'reserved' | 'occupied' | 'closed';
@Entity('tables')
export class TableEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Zone, (zone) => zone.tables, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' }) zone: Zone | null;
  @Column({ name: 'table_number' }) tableNumber: string;
  @Column({ default: 4 }) seats: number;
  @Column({ default: 'rectangle' }) shape: string;
  @Column({ name: 'photo_url', type: 'text', nullable: true }) photoUrl: string | null;
  @Column({ type: 'enum', enum: ['free', 'reserved', 'occupied', 'closed'], default: 'free' }) status: TableStatus;
  @Column({ type: 'numeric', default: 0 }) x: number;
  @Column({ type: 'numeric', default: 0 }) y: number;
  @Column({ type: 'numeric', default: 100 }) width: number;
  @Column({ type: 'numeric', default: 80 }) height: number;
  @Column({ type: 'numeric', default: 0 }) rotation: number;
  @Column({ name: 'is_visible', default: true }) isVisible: boolean;
  @OneToMany(() => Booking, (booking) => booking.table) bookings: Booking[];
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
