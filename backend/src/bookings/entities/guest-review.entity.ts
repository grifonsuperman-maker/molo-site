import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Booking } from './booking.entity';

@Entity('guest_reviews')
export class GuestReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Booking, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'text' })
  text: string;

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'external_review_opened_at', type: 'timestamp', nullable: true })
  externalReviewOpenedAt: Date | null;

  @Column({ name: 'response_text', type: 'text', nullable: true })
  responseText: string | null;

  @Column({ name: 'responded_at', type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  @Column({ name: 'responded_by_name', type: 'varchar', length: 160, nullable: true })
  respondedByName: string | null;

  @Column({ name: 'responded_by_role', type: 'varchar', length: 32, nullable: true })
  respondedByRole: string | null;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
