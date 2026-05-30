import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
@Entity('daily_statistics')
export class DailyStatistic {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'stat_date', type: 'date', unique: true }) statDate: string;
  @Column({ name: 'guests_count', default: 0 }) guestsCount: number;
  @Column({ name: 'bookings_count', default: 0 }) bookingsCount: number;
  @Column({ name: 'cancelled_count', default: 0 }) cancelledCount: number;
  @Column({ name: 'no_show_count', default: 0 }) noShowCount: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
