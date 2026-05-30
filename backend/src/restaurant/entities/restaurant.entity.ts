import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RestaurantStatus = 'open' | 'booking_closed' | 'closed';

@Entity('restaurant')
export class Restaurant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'MOLO Restaurant' })
  name: string;

  @Column({ nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'menu_url', type: 'text', nullable: true })
  menuUrl: string | null;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ name: 'main_photo_url', type: 'text', nullable: true })
  mainPhotoUrl: string | null;

  @Column({ name: 'open_time', type: 'time', default: '10:00' })
  openTime: string;

  @Column({ name: 'booking_close_time', type: 'time', default: '22:00' })
  bookingCloseTime: string;

  @Column({ name: 'close_time', type: 'time', default: '23:00' })
  closeTime: string;

  @Column({
    type: 'enum',
    enum: ['open', 'booking_closed', 'closed'],
    default: 'open',
  })
  status: RestaurantStatus;

  @Column({
    name: 'close_message',
    type: 'text',
    default: 'Ресторан зараз зачинений. Ми працюємо з 10:00 до 23:00.',
  })
  closeMessage: string;

  @Column({
    name: 'booking_closed_message',
    type: 'text',
    default:
      'Онлайн-бронювання завершено. Для бронювання зателефонуйте адміністратору.',
  })
  bookingClosedMessage: string;

  @Column({ name: 'map_width', type: 'numeric', default: 1600 })
  mapWidth: number;

  @Column({ name: 'map_height', type: 'numeric', default: 1000 })
  mapHeight: number;

  @Column({ name: 'booking_close_notified_at', type: 'date', nullable: true })
  bookingCloseNotifiedAt: string | null;

  @Column({ name: 'restaurant_close_notified_at', type: 'date', nullable: true })
  restaurantCloseNotifiedAt: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
