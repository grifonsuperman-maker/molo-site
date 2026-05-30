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
  constructor(@InjectRepository(TableEntity) private readonly tables:Repository<TableEntity>, @InjectRepository(Zone) private readonly zones:Repository<Zone>, @InjectRepository(Restaurant) private readonly restaurants:Repository<Restaurant>, @InjectRepository(MapObject) private readonly objects:Repository<MapObject>, private readonly logs:LogsService) {}
  async restaurant(){ const r=await this.restaurants.findOne({order:{createdAt:'ASC'}}); if(!r) throw new NotFoundException('Ресторан не знайдено'); return r; }
  async getFullMap(){ const restaurant=await this.restaurant(); return { restaurant, zones:await this.zones.find({relations:['tables'], order:{createdAt:'ASC'}}), tables:await this.tables.find({relations:['zone'], order:{tableNumber:'ASC'}}), objects:await this.objects.find({relations:['zone'], order:{createdAt:'ASC'}})}; }
  async getPublicMap(){
    const restaurant=await this.restaurant();
    const zones=await this.zones.find({where:{isVisible:true},relations:['tables'],order:{createdAt:'ASC'}});
    const visibleZoneIds=new Set(zones.map((zone)=>zone.id));
    const tables=(await this.tables.find({relations:['zone'],order:{tableNumber:'ASC'}})).filter((table)=>table.isVisible&&(!table.zone||visibleZoneIds.has(table.zone.id)));
    const objects=(await this.objects.find({relations:['zone'],order:{createdAt:'ASC'}})).filter((object)=>object.isVisible&&(!object.zone||visibleZoneIds.has(object.zone.id)));
    return { restaurant:{ id:restaurant.id, name:restaurant.name, status:restaurant.status, phone:restaurant.phone, menuUrl:restaurant.menuUrl, closeMessage:restaurant.closeMessage, bookingClosedMessage:restaurant.bookingClosedMessage, mapWidth:restaurant.mapWidth, mapHeight:restaurant.mapHeight }, zones, tables, objects };
  }
  async updateTablePosition(id:string,dto:UpdatePositionDto){ const t=await this.tables.findOne({where:{id}}); if(!t) throw new NotFoundException('Стіл не знайдено'); Object.assign(t,{x:dto.x,y:dto.y}); if(dto.rotation!==undefined)t.rotation=dto.rotation; await this.logs.create('Оновлено позицію столу',null,{id,...dto}); return this.tables.save(t); }
  async updateTableSize(id:string,dto:UpdateSizeDto){ const t=await this.tables.findOne({where:{id}}); if(!t) throw new NotFoundException('Стіл не знайдено'); Object.assign(t,dto); return this.tables.save(t); }
  async setTableVisibility(id:string,isVisible:boolean){ const t=await this.tables.findOne({where:{id}}); if(!t) throw new NotFoundException('Стіл не знайдено'); t.isVisible=isVisible; return this.tables.save(t); }
  async updateZonePosition(id:string,dto:UpdatePositionDto){ const z=await this.zones.findOne({where:{id}}); if(!z) throw new NotFoundException('Зону не знайдено'); Object.assign(z,{x:dto.x,y:dto.y}); if(dto.rotation!==undefined)z.rotation=dto.rotation; return this.zones.save(z); }
  async updateZoneSize(id:string,dto:UpdateSizeDto){ const z=await this.zones.findOne({where:{id}}); if(!z) throw new NotFoundException('Зону не знайдено'); Object.assign(z,dto); return this.zones.save(z); }
  async setZoneVisibility(id:string,isVisible:boolean){ const z=await this.zones.findOne({where:{id}}); if(!z) throw new NotFoundException('Зону не знайдено'); z.isVisible=isVisible; return this.zones.save(z); }
  async createObject(dto:CreateMapObjectDto){ const restaurant=await this.restaurant(); let zone:Zone|null=null; if(dto.zoneId){ zone=await this.zones.findOne({where:{id:dto.zoneId}}); if(!zone) throw new NotFoundException('Зону не знайдено'); } return this.objects.save(this.objects.create({restaurant, zone, objectType:dto.objectType, name:dto.name||null, x:dto.x??0,y:dto.y??0,width:dto.width??100,height:dto.height??100,rotation:dto.rotation??0,color:dto.color||null,isVisible:true})); }
  async updateObjectPosition(id:string,dto:UpdatePositionDto){ const o=await this.objects.findOne({where:{id}}); if(!o) throw new NotFoundException('Обʼєкт не знайдено'); Object.assign(o,{x:dto.x,y:dto.y}); if(dto.rotation!==undefined)o.rotation=dto.rotation; return this.objects.save(o); }
  async updateObjectSize(id:string,dto:UpdateSizeDto){ const o=await this.objects.findOne({where:{id}}); if(!o) throw new NotFoundException('Обʼєкт не знайдено'); Object.assign(o,dto); return this.objects.save(o); }
  async setObjectVisibility(id:string,isVisible:boolean){ const o=await this.objects.findOne({where:{id}}); if(!o) throw new NotFoundException('Обʼєкт не знайдено'); o.isVisible=isVisible; return this.objects.save(o); }
  async removeObject(id:string){ const o=await this.objects.findOne({where:{id}}); if(!o) throw new NotFoundException('Обʼєкт не знайдено'); await this.objects.remove(o); return {message:'Обʼєкт видалено'}; }
  async expandMap(dto:ExpandMapDto){ const r=await this.restaurant(); if(dto.direction==='left'||dto.direction==='right') r.mapWidth=Number(r.mapWidth)+dto.amount; if(dto.direction==='top'||dto.direction==='bottom') r.mapHeight=Number(r.mapHeight)+dto.amount; await this.restaurants.save(r); return {message:'Територію карти розширено', mapWidth:r.mapWidth, mapHeight:r.mapHeight}; }
}
