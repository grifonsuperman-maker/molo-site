import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Zone } from './entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(
    @InjectRepository(Zone)
    private readonly zones: Repository<Zone>,

    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
  ) {}

  findAll() {
    return this.zones.find({
      relations: ['tables'],
      order: { createdAt: 'ASC' },
    });
  }

  private async restaurant() {
    const restaurants = await this.restaurants.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    if (restaurants[0]) {
      return restaurants[0];
    }

    const restaurant = this.restaurants.create({
      name: 'MOLO',
      phone: null,
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
      adminCanManageZones: false,
      adminCanManageOnlineBooking: false,
      adminCanManageRestaurant: false,
      adminCanChangeSiteMode: false,
      adminCanEditRestaurantSettings: false,
      closeMessage: 'Ресторан зараз зачинений.\nМи працюємо з 10:00 до 23:00.',
      bookingClosedMessage:
        'Онлайн-бронювання завершено.\nДля бронювання зателефонуйте адміністратору.',
      mapWidth: 1600,
      mapHeight: 1000,
      bookingCloseNotifiedAt: null,
      restaurantCloseNotifiedAt: null,
    });

    return this.restaurants.save(restaurant);
  }

  private async assertAdminCanManageZones() {
    const restaurant = await this.restaurant();

    if (!restaurant.adminCanManageZones) {
      throw new ForbiddenException('Директор не надав право керувати локаціями');
    }

    return restaurant;
  }

  async create(dto: CreateZoneDto) {
    const restaurant = await this.restaurant();

    const zone = this.zones.create({
      restaurant,
      name: dto.name,
      color: dto.color || null,
      photoUrl: dto.photoUrl || null,
      description: dto.description || null,
      x: dto.x ?? 0,
      y: dto.y ?? 0,
      width: dto.width ?? 300,
      height: dto.height ?? 200,
      rotation: dto.rotation ?? 0,
      isVisible: dto.isVisible ?? true,
    });

    return this.zones.save(zone);
  }

  async update(id: string, dto: UpdateZoneDto) {
    const zone = await this.zones.findOne({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    Object.assign(zone, dto);

    return this.zones.save(zone);
  }

  async close(id: string) {
    const zone = await this.update(id, {});

    zone.isClosed = true;

    return this.zones.save(zone);
  }

  async open(id: string) {
    const zone = await this.update(id, {});

    zone.isClosed = false;

    return this.zones.save(zone);
  }

  async adminClose(id: string) {
    await this.assertAdminCanManageZones();
    return this.close(id);
  }

  async adminOpen(id: string) {
    await this.assertAdminCanManageZones();
    return this.open(id);
  }

  async remove(id: string) {
    const zone = await this.zones.findOne({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    await this.zones.remove(zone);

    return {
      message: 'Зону видалено',
    };
  }
}
