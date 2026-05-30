import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Staff } from '../../staff/entities/staff.entity';
@Entity('logs')
export class Log {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Staff, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'staff_id' }) staff: Staff | null;
  @Column() action: string;
  @Column({ type: 'jsonb', nullable: true }) details: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
