import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RestaurantService } from '../restaurant/restaurant.service';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { MapObject } from './entities/map-object.entity';
import { TableMapIdentityService } from '../tables/table-map-identity.service';
import { TableStatusProjectionService } from '../tables/table-status-projection.service';

@Injectable()
export class MapService {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(Zone)
    private readonly zones: Repository<Zone>,
    private readonly restaurantService: RestaurantService,
    @InjectRepository(MapObject)
    private readonly objects: Repository<MapObject>,
    private readonly mapIdentities: TableMapIdentityService,
    private readonly statuses: TableStatusProjectionService,
  ) {}

  private restaurant() {
    return this.restaurantService.getRestaurant();
  }

  async getFullMap() {
    const restaurant = await this.restaurant();
    const tables = await this.tables.find({
      relations: ['zone'], order: { tableNumber: 'ASC' } as any,
    });
    const zones = await this.zones.find({ relations: ['tables'], order: { createdAt: 'ASC' } as any });
    const snapshot = await this.statuses.captureMap(tables, zones);
    const physical = await this.mapIdentities.project(this.statuses.physical(tables, snapshot));

    return {
      restaurant,
      zones: this.statuses.zones(zones, snapshot),
      tables: physical.tables,
      mapIdentityPrepared: physical.prepared,
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

    const snapshot = await this.statuses.captureMap(tables, zones);
    const physical = await this.mapIdentities.project(this.statuses.physical(tables, snapshot));

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
      zones: this.statuses.zones(zones, snapshot),
      tables: physical.tables,
      mapIdentityPrepared: physical.prepared,
      objects,
    };
  }
}
