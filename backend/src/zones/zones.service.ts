import { ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Zone } from './entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

type DefaultLocation = {
  key: string;
  name: string;
  description: string;
  aliases: string[];
  tableNumbers: number[];
};

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const DEFAULT_LOCATIONS: DefaultLocation[] = [
  {
    key: 'hall',
    name: 'Зал ресторану',
    description: 'Столи 1–14',
    aliases: ['зал ресторану', 'зал', 'hall'],
    tableNumbers: range(1, 14),
  },
  {
    key: 'canopy',
    name: 'Навіс',
    description: 'Столи 15–20',
    aliases: ['навіс', 'навес', 'canopy'],
    tableNumbers: range(15, 20),
  },
  {
    key: 'gazebo',
    name: 'Велика альтанка',
    description: 'Столи 21–36',
    aliases: ['велика альтанка', 'велика бесідка', 'большая беседка', 'gazebo'],
    tableNumbers: range(21, 36),
  },
  {
    key: 'rotang',
    name: 'Ротанг',
    description: 'Столи 37–39',
    aliases: ['ротанг', 'rotang'],
    tableNumbers: range(37, 39),
  },
  {
    key: 'embankment',
    name: 'Набережна',
    description: 'Столи 40–44',
    aliases: ['набережна', 'набережная', 'embankment'],
    tableNumbers: range(40, 44),
  },
  {
    key: 'glass_gazebo',
    name: 'Скляна альтанка',
    description: 'Столи 45–50',
    aliases: ['скляна альтанка', 'стеклянная беседка', 'glass gazebo'],
    tableNumbers: range(45, 50),
  },
  {
    key: 'water_gazebo',
    name: 'Альтанка на воді',
    description: 'Столи 100–109',
    aliases: ['альтанка на воді', 'беседка на воде', 'water gazebo'],
    tableNumbers: range(100, 109),
  },
];

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTableNumber(value: string | number | null | undefined) {
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  return String(number);
}

function seatsForTable(tableNumber: number) {
  return tableNumber >= 5 && tableNumber <= 10 ? 6 : 4;
}

@Injectable()
export class ZonesService implements OnModuleInit {
  constructor(
    @InjectRepository(Zone)
    private readonly zones: Repository<Zone>,

    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,

    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultLocations();
  }

  async findAll() {
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

  async ensureDefaultLocations() {
    const restaurant = await this.restaurant();

    const existingZones = await this.zones.find({
      relations: ['tables'],
      order: { createdAt: 'ASC' },
    });

    const locationZones = new Map<string, Zone>();

    for (const location of DEFAULT_LOCATIONS) {
      let zone =
        existingZones.find((item) => {
          const normalizedName = normalizeText(item.name);
          return location.aliases.some((alias) => normalizedName.includes(normalizeText(alias)));
        }) || null;

      if (!zone) {
        zone = await this.zones.save(
          this.zones.create({
            restaurant,
            name: location.name,
            color: null,
            photoUrl: null,
            description: location.description,
            x: 0,
            y: 0,
            width: 300,
            height: 200,
            rotation: 0,
            isVisible: true,
            isClosed: false,
          }),
        );

        existingZones.push(zone);
      }

      locationZones.set(location.key, zone);
    }

    const existingTables = await this.tables.find({
      relations: ['zone'],
      order: { tableNumber: 'ASC' },
    });

    const tablesByNumber = new Map<string, TableEntity>();

    for (const table of existingTables) {
      const key = normalizeTableNumber(table.tableNumber);
      if (key && !tablesByNumber.has(key)) {
        tablesByNumber.set(key, table);
      }
    }

    const tablesToSave: TableEntity[] = [];

    for (const location of DEFAULT_LOCATIONS) {
      const zone = locationZones.get(location.key);
      if (!zone) continue;

      for (const tableNumber of location.tableNumbers) {
        const key = String(tableNumber);
        let table = tablesByNumber.get(key);

        if (!table) {
          table = this.tables.create({
            zone,
            tableNumber: key,
            seats: seatsForTable(tableNumber),
            shape: 'rectangle',
            photoUrl: null,
            status: 'free',
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            rotation: 0,
            isVisible: true,
          });

          tablesByNumber.set(key, table);
          tablesToSave.push(table);
          continue;
        }

        if (table.zone?.id !== zone.id) {
          table.zone = zone;
          tablesToSave.push(table);
        }
      }
    }

    if (tablesToSave.length > 0) {
      await this.tables.save(tablesToSave);
    }

    return this.zones.find({
      relations: ['tables'],
      order: { createdAt: 'ASC' },
    });
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
