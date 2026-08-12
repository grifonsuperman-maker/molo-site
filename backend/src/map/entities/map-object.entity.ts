import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Restaurant } from '../../restaurant/entities/restaurant.entity';
import { Zone } from '../../zones/entities/zone.entity';

@Entity('map_objects')
export class MapObject {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  @ManyToOne(() => Zone, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone: Zone | null;

  @Column({ name: 'object_type' }) objectType: string;
  @Column({ nullable: true }) name: string | null;
  @Column({ type: 'numeric', default: 0 }) x: number;
  @Column({ type: 'numeric', default: 0 }) y: number;
  @Column({ type: 'numeric', default: 100 }) width: number;
  @Column({ type: 'numeric', default: 100 }) height: number;
  @Column({ type: 'numeric', default: 0 }) rotation: number;
  @Column({ nullable: true }) color: string | null;
  @Column({ name: 'is_visible', default: true }) isVisible: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
