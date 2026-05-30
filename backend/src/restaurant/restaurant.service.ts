import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Restaurant } from './entities/restaurant.entity';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';
import { LogsService } from '../logs/logs.service';

@Injectable()
export class RestaurantService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,

    private readonly logsService: LogsService,
  ) {}

  private async getRestaurant() {
    const restaurant = await this.restaurantRepo.findOne({
      order: { createdAt: 'ASC' },
    });

    if (!restaurant) {
      throw new NotFoundException('Ресторан не знайдено');
    }

    return restaurant;
  }

  getSettings() {
    return this.getRestaurant();
  }

  async update(dto: UpdateRestaurantDto) {
    const restaurant = await this.getRestaurant();

    Object.assign(restaurant, dto);
    await this.restaurantRepo.save(restaurant);

    await this.logsService.create(
      'Оновлено налаштування ресторану',
      null,
      dto as Record<string, unknown>,
    );

    return {
      message: 'Налаштування ресторану оновлено',
      restaurant,
    };
  }

  async openRestaurant() {
    const restaurant = await this.getRestaurant();

    restaurant.status = 'open';
    await this.restaurantRepo.save(restaurant);

    await this.logsService.create('Ресторан відкрито', null, {
      status: restaurant.status,
    });

    return {
      message: 'Ресторан відкрито',
      status: restaurant.status,
    };
  }

  async closeBooking() {
    const restaurant = await this.getRestaurant();

    restaurant.status = 'booking_closed';
    await this.restaurantRepo.save(restaurant);

    await this.logsService.create('Онлайн-бронювання закрито', null, {
      status: restaurant.status,
    });

    return {
      message:
        'Онлайн-бронювання закрито. Доступний тільки дзвінок адміністратору.',
      status: restaurant.status,
    };
  }

  async closeRestaurant(dto: CloseRestaurantDto) {
    const restaurant = await this.getRestaurant();

    if (dto.message) {
      restaurant.closeMessage = dto.message;
    }

    restaurant.status = 'closed';
    await this.restaurantRepo.save(restaurant);

    await this.logsService.create('Ресторан повністю закрито', null, {
      status: restaurant.status,
      message: restaurant.closeMessage,
    });

    return {
      message: 'Ресторан повністю закрито',
      status: restaurant.status,
      closeMessage: restaurant.closeMessage,
    };
  }
}
