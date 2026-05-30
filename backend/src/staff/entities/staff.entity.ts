import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type StaffRole = 'owner' | 'admin' | 'waiter';

@Entity('staff')
export class Staff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'telegram_id', type: 'bigint', nullable: true, unique: true })
  telegramId: string | null;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ nullable: true })
  phone: string | null;

  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'waiter'],
    default: 'waiter',
  })
  role: StaffRole;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
