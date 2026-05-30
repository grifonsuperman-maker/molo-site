import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Zone } from './entities/zone.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
@Injectable()
export class ZonesService {
  constructor(@InjectRepository(Zone) private readonly zones: Repository<Zone>, @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>) {}
  findAll(){ return this.zones.find({ relations:['tables'], order:{ createdAt:'ASC' }}); }
  async restaurant(){ const r=await this.restaurants.findOne({order:{createdAt:'ASC'}}); if(!r) throw new NotFoundException('Ресторан не знайдено'); return r; }
  async create(dto:CreateZoneDto){ const restaurant=await this.restaurant(); return this.zones.save(this.zones.create({ restaurant, name:dto.name, color:dto.color||null, photoUrl:dto.photoUrl||null, description:dto.description||null, x:dto.x??0,y:dto.y??0,width:dto.width??300,height:dto.height??200,rotation:dto.rotation??0,isVisible:dto.isVisible??true })); }
  async update(id:string,dto:UpdateZoneDto){ const z=await this.zones.findOne({where:{id}}); if(!z) throw new NotFoundException('Зону не знайдено'); Object.assign(z,dto); return this.zones.save(z); }
  async close(id:string){ const z=await this.update(id,{}); z.isClosed=true; return this.zones.save(z); }
  async open(id:string){ const z=await this.update(id,{}); z.isClosed=false; return this.zones.save(z); }
  async remove(id:string){ const z=await this.zones.findOne({where:{id}}); if(!z) throw new NotFoundException('Зону не знайдено'); await this.zones.remove(z); return {message:'Зону видалено'}; }
}
