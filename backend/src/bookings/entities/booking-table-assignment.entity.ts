import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { TableEntity } from '../../tables/entities/table.entity';
import { Booking } from './booking.entity';

@Index(
  'UQ_booking_table_assignments_booking_table',
  ['booking', 'table'],
  { unique: true },
)
@Index(
  'UQ_booking_table_assignments_primary_booking',
  ['booking'],
  {
    unique: true,
    where: '"is_primary" = true',
  },
)
@Index('IDX_booking_table_assignments_table', ['table'])
@Entity({ name: 'booking_table_assignments', synchronize: false })
export class BookingTableAssignment {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_booking_table_assignments',
  })
  id: string;

  @ManyToOne(() => Booking, (booking) => booking.tableAssignments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'FK_booking_table_assignments_booking',
  })
  booking: Booking;

  @ManyToOne(() => TableEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'table_id',
    foreignKeyConstraintName: 'FK_booking_table_assignments_table',
  })
  table: TableEntity;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
