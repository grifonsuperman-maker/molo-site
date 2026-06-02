import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { MapObject } from './entities/map-object.entity';
import { LogsService } from '../logs/logs.service';
import { UpdatePositionDto } from './dto/update-position.dto';
import { UpdateSizeDto } from './dto/update-size.dto';
import { ExpandMapDto } from './dto/expand-map.dto';
import { CreateMapObjectDto } from './dto/create-map-object.dto';

@Injectable()
export class ConstructorService {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,

    @InjectRepository(Zone)
    private readonly zones: Repository<Zone>,

    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,

    @InjectRepository(MapObject)
    private readonly objects: Repository<MapObject>,

    private readonly logs: LogsService,
  ) {}

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
      closeMessage: 'Ресторан зараз зачинений.\nМи працюємо з 10:00 до 23:00.',
      bookingClosedMessage:
        'Онлайн-бронювання завершено.\nДля бронювання зателефонуйте адміністратору.',
      mapWidth: 2200,
      mapHeight: 1500,
      bookingCloseNotifiedAt: null,
      restaurantCloseNotifiedAt: null,
    });

    return this.restaurants.save(restaurant);
  }

  async getFullMap() {
    const restaurant = await this.restaurant();

    return {
      restaurant,
      zones: await this.zones.find({
        relations: ['tables'],
        order: { createdAt: 'ASC' },
      }),
      tables: await this.tables.find({
        relations: ['zone'],
        order: { tableNumber: 'ASC' },
      }),
      objects: await this.objects.find({
        relations: ['zone'],
        order: { createdAt: 'ASC' },
      }),
    };
  }

  async getPublicMap() {
    const restaurant = await this.restaurant();

    const zones = await this.zones.find({
      where: { isVisible: true },
      relations: ['tables'],
      order: { createdAt: 'ASC' },
    });

    const visibleZoneIds = new Set(zones.map((zone) => zone.id));

    const tables = (
      await this.tables.find({
        relations: ['zone'],
        order: { tableNumber: 'ASC' },
      })
    ).filter(
      (table) =>
        table.isVisible &&
        (!table.zone || visibleZoneIds.has(table.zone.id)),
    );

    const objects = (
      await this.objects.find({
        relations: ['zone'],
        order: { createdAt: 'ASC' },
      })
    ).filter(
      (object) =>
        object.isVisible &&
        (!object.zone || visibleZoneIds.has(object.zone.id)),
    );

    return {
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        status: restaurant.status,
        phone: restaurant.phone,
        menuUrl: restaurant.menuUrl,
        logoUrl: restaurant.logoUrl,
        mainPhotoUrl: restaurant.mainPhotoUrl,
        closeMessage: restaurant.closeMessage,
        bookingClosedMessage: restaurant.bookingClosedMessage,
        mapWidth: restaurant.mapWidth,
        mapHeight: restaurant.mapHeight,
      },
      zones,
      tables,
      objects,
    };
  }

  async updateTablePosition(id: string, dto: UpdatePositionDto) {
    const table = await this.tables.findOne({
      where: { id },
    });

    if (!table) {
      throw new NotFoundException('Стіл не знайдено');
    }

    table.x = dto.x;
    table.y = dto.y;

    if (dto.rotation !== undefined) {
      table.rotation = dto.rotation;
    }

    await this.logs.create('Оновлено позицію столу', null, {
      id,
      ...dto,
    });

    return this.tables.save(table);
  }

  async updateTableSize(id: string, dto: UpdateSizeDto) {
    const table = await this.tables.findOne({
      where: { id },
    });

    if (!table) {
      throw new NotFoundException('Стіл не знайдено');
    }

    Object.assign(table, dto);

    return this.tables.save(table);
  }

  async setTableVisibility(id: string, isVisible: boolean) {
    const table = await this.tables.findOne({
      where: { id },
    });

    if (!table) {
      throw new NotFoundException('Стіл не знайдено');
    }

    table.isVisible = isVisible;

    return this.tables.save(table);
  }

  async updateZonePosition(id: string, dto: UpdatePositionDto) {
    const zone = await this.zones.findOne({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    zone.x = dto.x;
    zone.y = dto.y;

    if (dto.rotation !== undefined) {
      zone.rotation = dto.rotation;
    }

    return this.zones.save(zone);
  }

  async updateZoneSize(id: string, dto: UpdateSizeDto) {
    const zone = await this.zones.findOne({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    Object.assign(zone, dto);

    return this.zones.save(zone);
  }

  async setZoneVisibility(id: string, isVisible: boolean) {
    const zone = await this.zones.findOne({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    zone.isVisible = isVisible;

    return this.zones.save(zone);
  }

  async createObject(dto: CreateMapObjectDto) {
    const restaurant = await this.restaurant();

    let zone: Zone | null = null;

    if (dto.zoneId) {
      zone = await this.zones.findOne({
        where: { id: dto.zoneId },
      });

      if (!zone) {
        throw new NotFoundException('Зону не знайдено');
      }
    }

    const object = this.objects.create({
      restaurant,
      zone,
      objectType: dto.objectType,
      name: dto.name || null,
      x: dto.x ?? 0,
      y: dto.y ?? 0,
      width: dto.width ?? 100,
      height: dto.height ?? 100,
      rotation: dto.rotation ?? 0,
      color: dto.color || null,
      isVisible: true,
    });

    return this.objects.save(object);
  }

  async updateObject(id: string, dto: CreateMapObjectDto) {
    const object = await this.objects.findOne({
      where: { id },
      relations: ['zone'],
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    if (dto.zoneId) {
      const zone = await this.zones.findOne({
        where: { id: dto.zoneId },
      });

      if (!zone) {
        throw new NotFoundException('Зону не знайдено');
      }

      object.zone = zone;
    }

    if (dto.objectType !== undefined) {
      object.objectType = dto.objectType;
    }

    if (dto.name !== undefined) {
      object.name = dto.name || null;
    }

    if (dto.x !== undefined) {
      object.x = dto.x;
    }

    if (dto.y !== undefined) {
      object.y = dto.y;
    }

    if (dto.width !== undefined) {
      object.width = dto.width;
    }

    if (dto.height !== undefined) {
      object.height = dto.height;
    }

    if (dto.rotation !== undefined) {
      object.rotation = dto.rotation;
    }

    if (dto.color !== undefined) {
      object.color = dto.color || null;
    }

    return this.objects.save(object);
  }

  async updateObjectPosition(id: string, dto: UpdatePositionDto) {
    const object = await this.objects.findOne({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    object.x = dto.x;
    object.y = dto.y;

    if (dto.rotation !== undefined) {
      object.rotation = dto.rotation;
    }

    return this.objects.save(object);
  }

  async updateObjectSize(id: string, dto: UpdateSizeDto) {
    const object = await this.objects.findOne({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    Object.assign(object, dto);

    return this.objects.save(object);
  }

  async setObjectVisibility(id: string, isVisible: boolean) {
    const object = await this.objects.findOne({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    object.isVisible = isVisible;

    return this.objects.save(object);
  }

  async removeObject(id: string) {
    const object = await this.objects.findOne({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    await this.objects.remove(object);

    return {
      message: 'Обʼєкт видалено',
    };
  }

  async expandMap(dto: ExpandMapDto) {
    const restaurant = await this.restaurant();

    if (dto.direction === 'left' || dto.direction === 'right') {
      restaurant.mapWidth = Number(restaurant.mapWidth) + dto.amount;
    }

    if (dto.direction === 'top' || dto.direction === 'bottom') {
      restaurant.mapHeight = Number(restaurant.mapHeight) + dto.amount;
    }

    await this.restaurants.save(restaurant);

    return {
      message: 'Територію карти розширено',
      mapWidth: restaurant.mapWidth,
      mapHeight: restaurant.mapHeight,
    };
  }
}
