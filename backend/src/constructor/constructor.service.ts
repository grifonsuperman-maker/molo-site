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
import { SaveLayoutDto } from './dto/save-layout.dto';

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

  private async restaurant(): Promise<Restaurant> {
    const restaurants = await this.restaurants.find({
      order: { createdAt: 'ASC' } as any,
      take: 1,
    });

    if (restaurants.length > 0 && restaurants[0]) {
      return restaurants[0];
    }

    const restaurant = this.restaurants.create() as unknown as Restaurant;

    Object.assign(restaurant as any, {
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

    return (await this.restaurants.save(restaurant as any)) as Restaurant;
  }

  async getFullMap() {
    const restaurant = await this.restaurant();

    return {
      restaurant,
      zones: await this.zones.find({
        relations: ['tables'],
        order: { createdAt: 'ASC' } as any,
      }),
      tables: await this.tables.find({
        relations: ['zone'],
        order: { tableNumber: 'ASC' } as any,
      }),
      objects: await this.objects.find({
        relations: ['zone'],
        order: { createdAt: 'ASC' } as any,
      }),
    };
  }

  async getPublicMap() {
    const restaurant = await this.restaurant();

    const allZones = await this.zones.find({
      relations: ['tables'],
      order: { createdAt: 'ASC' } as any,
    });

    const zones = allZones.filter((zone) => (zone as any).isVisible !== false);
    const visibleZoneIds = new Set(zones.map((zone) => (zone as any).id));

    const tables = (
      await this.tables.find({
        relations: ['zone'],
        order: { tableNumber: 'ASC' } as any,
      })
    ).filter((table) => {
      const tableAny = table as any;
      return (
        tableAny.isVisible !== false &&
        (!tableAny.zone || visibleZoneIds.has(tableAny.zone.id))
      );
    });

    const objects = (
      await this.objects.find({
        relations: ['zone'],
        order: { createdAt: 'ASC' } as any,
      })
    ).filter((object) => {
      const objectAny = object as any;
      return (
        objectAny.isVisible !== false &&
        (!objectAny.zone || visibleZoneIds.has(objectAny.zone.id))
      );
    });

    return {
      restaurant: {
        id: (restaurant as any).id,
        name: (restaurant as any).name,
        status: (restaurant as any).status,
        phone: (restaurant as any).phone,
        menuUrl: (restaurant as any).menuUrl,
        logoUrl: (restaurant as any).logoUrl,
        mainPhotoUrl: (restaurant as any).mainPhotoUrl,
        closeMessage: (restaurant as any).closeMessage,
        bookingClosedMessage: (restaurant as any).bookingClosedMessage,
        mapWidth: (restaurant as any).mapWidth,
        mapHeight: (restaurant as any).mapHeight,
      },
      zones,
      tables,
      objects,
    };
  }

  async saveLayout(dto: SaveLayoutDto) {
    const result = {
      tables: 0,
      zones: 0,
      objects: 0,
    };

    for (const item of dto.tables || []) {
      if (!item.id) continue;

      const table = await this.tables.findOne({
        where: { id: item.id } as any,
      });

      if (!table) continue;

      if (item.x !== undefined) (table as any).x = Number(item.x);
      if (item.y !== undefined) (table as any).y = Number(item.y);
      if (item.width !== undefined) (table as any).width = Number(item.width);
      if (item.height !== undefined) (table as any).height = Number(item.height);
      if (item.rotation !== undefined) (table as any).rotation = Number(item.rotation);
      if (item.tableNumber !== undefined) (table as any).tableNumber = item.tableNumber;
      if (item.seats !== undefined) (table as any).seats = Number(item.seats);
      if (item.shape !== undefined) (table as any).shape = item.shape;
      if (item.isVisible !== undefined) (table as any).isVisible = item.isVisible;

      await this.tables.save(table as any);
      result.tables += 1;
    }

    for (const item of dto.zones || []) {
      if (!item.id) continue;

      const zone = await this.zones.findOne({
        where: { id: item.id } as any,
      });

      if (!zone) continue;

      if (item.x !== undefined) (zone as any).x = Number(item.x);
      if (item.y !== undefined) (zone as any).y = Number(item.y);
      if (item.width !== undefined) (zone as any).width = Number(item.width);
      if (item.height !== undefined) (zone as any).height = Number(item.height);
      if (item.rotation !== undefined) (zone as any).rotation = Number(item.rotation);
      if (item.name !== undefined) (zone as any).name = item.name;
      if (item.color !== undefined) (zone as any).color = item.color;
      if (item.description !== undefined) (zone as any).description = item.description;
      if (item.isVisible !== undefined) (zone as any).isVisible = item.isVisible;
      if (item.isClosed !== undefined) (zone as any).isClosed = item.isClosed;

      await this.zones.save(zone as any);
      result.zones += 1;
    }

    for (const item of dto.objects || []) {
      if (!item.id) continue;

      const object = await this.objects.findOne({
        where: { id: item.id } as any,
      });

      if (!object) continue;

      if (item.objectType !== undefined) (object as any).objectType = item.objectType;
      if (item.name !== undefined) (object as any).name = item.name || null;
      if (item.x !== undefined) (object as any).x = Number(item.x);
      if (item.y !== undefined) (object as any).y = Number(item.y);
      if (item.width !== undefined) (object as any).width = Number(item.width);
      if (item.height !== undefined) (object as any).height = Number(item.height);
      if (item.rotation !== undefined) (object as any).rotation = Number(item.rotation);
      if (item.color !== undefined) (object as any).color = item.color || null;
      if (item.isVisible !== undefined) (object as any).isVisible = item.isVisible;

      await this.objects.save(object as any);
      result.objects += 1;
    }

    await this.logs.create('Збережено карту конструктора', null as any, result as any);

    return {
      message: 'Карту збережено',
      ...result,
    };
  }

  async updateTablePosition(id: string, dto: UpdatePositionDto) {
    const table = await this.tables.findOne({
      where: { id } as any,
    });

    if (!table) {
      throw new NotFoundException('Стіл не знайдено');
    }

    (table as any).x = Number(dto.x);
    (table as any).y = Number(dto.y);

    if (dto.rotation !== undefined) {
      (table as any).rotation = Number(dto.rotation);
    }

    await this.logs.create(
      'Оновлено позицію столу',
      null as any,
      {
        id,
        ...dto,
      } as any,
    );

    return this.tables.save(table as any);
  }

  async updateTableSize(id: string, dto: UpdateSizeDto) {
    const table = await this.tables.findOne({
      where: { id } as any,
    });

    if (!table) {
      throw new NotFoundException('Стіл не знайдено');
    }

    Object.assign(table as any, dto as any);

    return this.tables.save(table as any);
  }

  async setTableVisibility(id: string, isVisible: boolean) {
    const table = await this.tables.findOne({
      where: { id } as any,
    });

    if (!table) {
      throw new NotFoundException('Стіл не знайдено');
    }

    (table as any).isVisible = isVisible;

    return this.tables.save(table as any);
  }

  async updateZonePosition(id: string, dto: UpdatePositionDto) {
    const zone = await this.zones.findOne({
      where: { id } as any,
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    (zone as any).x = Number(dto.x);
    (zone as any).y = Number(dto.y);

    if (dto.rotation !== undefined) {
      (zone as any).rotation = Number(dto.rotation);
    }

    return this.zones.save(zone as any);
  }

  async updateZoneSize(id: string, dto: UpdateSizeDto) {
    const zone = await this.zones.findOne({
      where: { id } as any,
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    Object.assign(zone as any, dto as any);

    return this.zones.save(zone as any);
  }

  async setZoneVisibility(id: string, isVisible: boolean) {
    const zone = await this.zones.findOne({
      where: { id } as any,
    });

    if (!zone) {
      throw new NotFoundException('Зону не знайдено');
    }

    (zone as any).isVisible = isVisible;

    return this.zones.save(zone as any);
  }

  async createObject(dto: CreateMapObjectDto) {
    const restaurant = await this.restaurant();

    let zone: Zone | null = null;

    if ((dto as any).zoneId) {
      zone = await this.zones.findOne({
        where: { id: (dto as any).zoneId } as any,
      });

      if (!zone) {
        throw new NotFoundException('Зону не знайдено');
      }
    }

const object = this.objects.create() as unknown as MapObject;

Object.assign(object as any, {
  restaurant,
  zone,
  objectType: dto.objectType,
  name: dto.name || null,
  x: Number(dto.x ?? 0),
  y: Number(dto.y ?? 0),
  width: Number(dto.width ?? 100),
  height: Number(dto.height ?? 100),
  rotation: Number(dto.rotation ?? 0),
  color: dto.color || null,
  isVisible: true,
});

return this.objects.save(object as any);
  }

  async updateObject(id: string, dto: CreateMapObjectDto) {
    const object = await this.objects.findOne({
      where: { id } as any,
      relations: ['zone'],
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    if ((dto as any).zoneId) {
      const zone = await this.zones.findOne({
        where: { id: (dto as any).zoneId } as any,
      });

      if (!zone) {
        throw new NotFoundException('Зону не знайдено');
      }

      (object as any).zone = zone;
    }

    if (dto.objectType !== undefined) (object as any).objectType = dto.objectType;
    if (dto.name !== undefined) (object as any).name = dto.name || null;
    if (dto.x !== undefined) (object as any).x = Number(dto.x);
    if (dto.y !== undefined) (object as any).y = Number(dto.y);
    if (dto.width !== undefined) (object as any).width = Number(dto.width);
    if (dto.height !== undefined) (object as any).height = Number(dto.height);
    if (dto.rotation !== undefined) (object as any).rotation = Number(dto.rotation);
    if (dto.color !== undefined) (object as any).color = dto.color || null;

    return this.objects.save(object as any);
  }

  async updateObjectPosition(id: string, dto: UpdatePositionDto) {
    const object = await this.objects.findOne({
      where: { id } as any,
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    (object as any).x = Number(dto.x);
    (object as any).y = Number(dto.y);

    if (dto.rotation !== undefined) {
      (object as any).rotation = Number(dto.rotation);
    }

    return this.objects.save(object as any);
  }

  async updateObjectSize(id: string, dto: UpdateSizeDto) {
    const object = await this.objects.findOne({
      where: { id } as any,
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    Object.assign(object as any, dto as any);

    return this.objects.save(object as any);
  }

  async setObjectVisibility(id: string, isVisible: boolean) {
    const object = await this.objects.findOne({
      where: { id } as any,
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    (object as any).isVisible = isVisible;

    return this.objects.save(object as any);
  }

  async removeObject(id: string) {
    const object = await this.objects.findOne({
      where: { id } as any,
    });

    if (!object) {
      throw new NotFoundException('Обʼєкт не знайдено');
    }

    await this.objects.remove(object as any);

    return {
      message: 'Обʼєкт видалено',
    };
  }

  async expandMap(dto: ExpandMapDto) {
    const restaurant = await this.restaurant();

    if (dto.direction === 'left' || dto.direction === 'right') {
      (restaurant as any).mapWidth =
        Number((restaurant as any).mapWidth || 2200) + Number(dto.amount);
    }

    if (dto.direction === 'top' || dto.direction === 'bottom') {
      (restaurant as any).mapHeight =
        Number((restaurant as any).mapHeight || 1500) + Number(dto.amount);
    }

    await this.restaurants.save(restaurant as any);

    return {
      message: 'Територію карти розширено',
      mapWidth: (restaurant as any).mapWidth,
      mapHeight: (restaurant as any).mapHeight,
    };
  }
}
