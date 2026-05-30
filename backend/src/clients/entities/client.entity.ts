import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'full_name' }) fullName: string;
  @Column({ unique: true }) phone: string;
  @Column({ name: 'telegram_id', type: 'bigint', nullable: true, unique: true }) telegramId: string | null;
  @Column({ name: 'visits_count', default: 0 }) visitsCount: number;
  @Column({ name: 'total_guests', default: 0 }) totalGuests: number;
  @Column({ name: 'cancellations_count', default: 0 }) cancellationsCount: number;
  @Column({ name: 'reschedules_count', default: 0 }) reschedulesCount: number;
  @Column({ name: 'last_visit_at', type: 'timestamp', nullable: true }) lastVisitAt: Date | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column({ name: 'is_regular', default: false }) isRegular: boolean;
  @Column({ name: 'is_blacklisted', default: false }) isBlacklisted: boolean;
  @OneToMany(() => Booking, (booking) => booking.client) bookings: Booking[];
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
