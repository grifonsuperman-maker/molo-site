import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RestaurantStatus = 'open' | 'booking_closed' | 'closed';
export type SiteMode = 'day' | 'night' | 'holiday';

export type HolidayKey =
  | 'new-year'
  | 'christmas'
  | 'valentines'
  | 'easter'
  | 'halloween'
  | 'march-8';

@Entity('restaurant')
export class Restaurant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'MOLO Restaurant' })
  name: string;

  @Column({ nullable: true })
  phone: string | null;

  @Column({ name: 'admin_can_manage_zones', default: false })
  adminCanManageZones: boolean;

  @Column({ name: 'admin_can_manage_online_booking', default: false })
  adminCanManageOnlineBooking: boolean;

  @Column({ name: 'admin_can_manage_restaurant', default: false })
  adminCanManageRestaurant: boolean;

  @Column({ name: 'admin_can_change_site_mode', default: false })
  adminCanChangeSiteMode: boolean;

  @Column({ name: 'admin_can_edit_restaurant_settings', default: false })
  adminCanEditRestaurantSettings: boolean;

  @Column({ name: 'admin_can_manage_blacklist', default: false })
  adminCanManageBlacklist: boolean;

  @Column({ name: 'admin_can_respond_reviews', default: false })
  adminCanRespondReviews: boolean;

  @Column({ name: 'admin_can_manage_staff_shifts', default: false })
  adminCanManageStaffShifts: boolean;

  @Column({ name: 'admin_can_send_broadcasts', default: false })
  adminCanSendBroadcasts: boolean;

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
    name: 'site_mode',
    type: 'enum',
    enum: ['day', 'night', 'holiday'],
    default: 'night',
  })
  siteMode: SiteMode;

  @Column({
    name: 'holiday_key',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  holidayKey: HolidayKey | null;

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

  @Column({
    name: 'booking_close_notified_at',
    type: 'date',
    nullable: true,
  })
  bookingCloseNotifiedAt: string | null;

  @Column({
    name: 'restaurant_close_notified_at',
    type: 'date',
    nullable: true,
  })
  restaurantCloseNotifiedAt: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
