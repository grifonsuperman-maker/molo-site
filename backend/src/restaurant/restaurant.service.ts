import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Restaurant, SiteMode } from './entities/restaurant.entity';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';
import { LogsService } from '../logs/logs.service';

type AdminPermissionKey =
  | 'adminCanManageOnlineBooking'
  | 'adminCanManageRestaurant'
  | 'adminCanChangeSiteMode'
  | 'adminCanEditRestaurantSettings';

@Injectable()
export class RestaurantService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly repo: Repository<Restaurant>,
    private readonly logs: LogsService,
  ) {}

  private async findOrCreateRestaurant() {
    const restaurants = await this.repo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    if (restaurants[0]) {
      return restaurants[0];
    }

    const restaurant = this.repo.create({
      name: 'MOLO',
      phone: null,
      adminCanManageZones: false,
      adminCanManageOnlineBooking: false,
      adminCanManageRestaurant: false,
      adminCanChangeSiteMode: false,
      adminCanEditRestaurantSettings: false,
      address: null,
      menuUrl:
        'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio',
      logoUrl: '/logo.png',
      mainPhotoUrl: '/logo.png',
      openTime: '10:00',
      bookingCloseTime: '22:00',
      closeTime: '23:00',
      status: 'open',
      siteMode: 'night',
      closeMessage: 'Ресторан зараз зачинений.\nМи працюємо з 10:00 до 23:00.',
      bookingClosedMessage:
        'Онлайн-бронювання завершено.\nДля бронювання зателефонуйте адміністратору.',
      mapWidth: 1600,
      mapHeight: 1000,
      bookingCloseNotifiedAt: null,
      restaurantCloseNotifiedAt: null,
    });

    return this.repo.save(restaurant);
  }

  async getRestaurant() {
    return this.findOrCreateRestaurant();
  }

  getSettings() {
    return this.getRestaurant();
  }

  private async assertAdminPermission(permission: AdminPermissionKey, message: string) {
    const restaurant = await this.getRestaurant();

    if (!restaurant[permission]) {
      throw new ForbiddenException(message);
    }

    return restaurant;
  }

  async update(dto: UpdateRestaurantDto) {
    const restaurant = await this.getRestaurant();

    Object.assign(restaurant, dto);

    await this.repo.save(restaurant);

    await this.logs.create('Оновлено налаштування ресторану директором', null, dto as any);

    return {
      message: 'Налаштування ресторану оновлено',
      restaurant,
    };
  }

  async openRestaurant() {
    const restaurant = await this.getRestaurant();

    restaurant.status = 'open';

    await this.repo.save(restaurant);
    await this.logs.create('Ресторан відкрито директором');

    return {
      message: 'Ресторан відкрито',
      status: restaurant.status,
    };
  }

  async closeBooking() {
    const restaurant = await this.getRestaurant();

    restaurant.status = 'booking_closed';

    await this.repo.save(restaurant);
    await this.logs.create('Онлайн-бронювання закрито директором');

    return {
      message: 'Онлайн-бронювання закрито',
      status: restaurant.status,
    };
  }

  async openBooking() {
    const restaurant = await this.getRestaurant();

    restaurant.status = 'open';

    await this.repo.save(restaurant);
    await this.logs.create('Онлайн-бронювання відкрито директором');

    return {
      message: 'Онлайн-бронювання відкрито',
      status: restaurant.status,
    };
  }

  async closeRestaurant(dto: CloseRestaurantDto) {
    const restaurant = await this.getRestaurant();

    if (dto.message) {
      restaurant.closeMessage = dto.message;
    }

    restaurant.status = 'closed';

    await this.repo.save(restaurant);

    await this.logs.create('Ресторан повністю закрито директором', null, {
      message: restaurant.closeMessage,
    });

    return {
      message: 'Ресторан повністю закрито',
      status: restaurant.status,
      closeMessage: restaurant.closeMessage,
    };
  }

  async adminOpenBooking() {
    const restaurant = await this.assertAdminPermission(
      'adminCanManageOnlineBooking',
      'Директор не надав право відкривати онлайн-бронювання',
    );

    if (restaurant.status === 'closed') {
      throw new ForbiddenException('Ресторан закритий. Для відкриття потрібне окреме право');
    }

    restaurant.status = 'open';
    await this.repo.save(restaurant);
    await this.logs.create('Адміністратор відкрив онлайн-бронювання');

    return {
      message: 'Онлайн-бронювання відкрито',
      status: restaurant.status,
    };
  }

  async adminCloseBooking() {
    const restaurant = await this.assertAdminPermission(
      'adminCanManageOnlineBooking',
      'Директор не надав право закривати онлайн-бронювання',
    );

    if (restaurant.status === 'closed') {
      throw new ForbiddenException('Ресторан уже повністю закритий');
    }

    restaurant.status = 'booking_closed';
    await this.repo.save(restaurant);
    await this.logs.create('Адміністратор закрив онлайн-бронювання');

    return {
      message: 'Онлайн-бронювання закрито',
      status: restaurant.status,
    };
  }

  async adminOpenRestaurant() {
    const restaurant = await this.assertAdminPermission(
      'adminCanManageRestaurant',
      'Директор не надав право відкривати ресторан',
    );

    restaurant.status = 'open';
    await this.repo.save(restaurant);
    await this.logs.create('Адміністратор відкрив ресторан');

    return {
      message: 'Ресторан відкрито',
      status: restaurant.status,
    };
  }

  async adminCloseRestaurant(dto: CloseRestaurantDto) {
    const restaurant = await this.assertAdminPermission(
      'adminCanManageRestaurant',
      'Директор не надав право закривати ресторан',
    );

    if (dto.message) {
      restaurant.closeMessage = dto.message;
    }

    restaurant.status = 'closed';
    await this.repo.save(restaurant);
    await this.logs.create('Адміністратор закрив ресторан', null, {
      message: restaurant.closeMessage,
    });

    return {
      message: 'Ресторан закрито',
      status: restaurant.status,
      closeMessage: restaurant.closeMessage,
    };
  }

  async adminChangeSiteMode(siteMode: SiteMode) {
    const restaurant = await this.assertAdminPermission(
      'adminCanChangeSiteMode',
      'Директор не надав право змінювати режим сайту',
    );

    restaurant.siteMode = siteMode;
    await this.repo.save(restaurant);
    await this.logs.create('Адміністратор змінив режим сайту', null, { siteMode });

    return {
      message: 'Режим сайту змінено',
      siteMode: restaurant.siteMode,
    };
  }

  async adminUpdateSettings(dto: UpdateRestaurantDto) {
    const restaurant = await this.assertAdminPermission(
      'adminCanEditRestaurantSettings',
      'Директор не надав право змінювати налаштування ресторану',
    );

    if (dto.menuUrl !== undefined) restaurant.menuUrl = dto.menuUrl;
    if (dto.closeMessage !== undefined) restaurant.closeMessage = dto.closeMessage;
    if (dto.bookingClosedMessage !== undefined) {
      restaurant.bookingClosedMessage = dto.bookingClosedMessage;
    }

    await this.repo.save(restaurant);
    await this.logs.create('Адміністратор оновив дозволені налаштування ресторану', null, {
      menuUrl: restaurant.menuUrl,
      closeMessage: restaurant.closeMessage,
      bookingClosedMessage: restaurant.bookingClosedMessage,
    });

    return {
      message: 'Налаштування оновлено',
      restaurant,
    };
  }
}
