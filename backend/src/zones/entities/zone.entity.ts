import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Restaurant } from '../../restaurant/entities/restaurant.entity';
import { TableEntity } from '../../tables/entities/table.entity';
@Entity('zones')
export class Zone {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' }) restaurant: Restaurant;
  @Column() name: string;
  @Column({ nullable: true }) color: string | null;
  @Column({ name: 'photo_url', type: 'text', nullable: true }) photoUrl: string | null;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'numeric', default: 0 }) x: number;
  @Column({ type: 'numeric', default: 0 }) y: number;
  @Column({ type: 'numeric', default: 300 }) width: number;
  @Column({ type: 'numeric', default: 200 }) height: number;
  @Column({ type: 'numeric', default: 0 }) rotation: number;
  @Column({ name: 'is_closed', default: false }) isClosed: boolean;
  @Column({ name: 'is_visible', default: true }) isVisible: boolean;
  @OneToMany(() => TableEntity, (table) => table.zone) tables: TableEntity[];
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
