import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Staff } from '../../staff/entities/staff.entity';
export type BroadcastTarget = 'all_clients' | 'regular_clients' | 'recent_clients' | 'selected_clients';
@Entity('broadcasts')
export class Broadcast {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Staff, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_staff_id' }) createdByStaff: Staff | null;
  @Column({ nullable: true }) title: string | null;
  @Column({ type: 'text' }) message: string;
  @Column({ default: 'all_clients' }) target: BroadcastTarget;
  @Column({ name: 'sent_at', type: 'timestamp', nullable: true }) sentAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
