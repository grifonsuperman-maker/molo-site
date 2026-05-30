import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TableEntity, TableStatus } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
@Injectable()
export class TablesService {
  constructor(@InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>, @InjectRepository(Zone) private readonly zones: Repository<Zone>) {}
  findAll(){ return this.tables.find({ relations:['zone'], order:{ tableNumber:'ASC' }}); }
  async create(dto:CreateTableDto){ let zone:Zone|null=null; if(dto.zoneId){ zone=await this.zones.findOne({where:{id:dto.zoneId}}); if(!zone) throw new NotFoundException('Зону не знайдено'); } return this.tables.save(this.tables.create({ zone, tableNumber:dto.tableNumber, seats:dto.seats, shape:dto.shape||'rectangle', photoUrl:dto.photoUrl||null, x:dto.x??0,y:dto.y??0,width:dto.width??100,height:dto.height??80,rotation:dto.rotation??0,status:'free' })); }
  async update(id:string,dto:UpdateTableDto){ const t=await this.tables.findOne({where:{id}, relations:['zone']}); if(!t) throw new NotFoundException('Стіл не знайдено'); if(dto.zoneId){ const z=await this.zones.findOne({where:{id:dto.zoneId}}); if(!z) throw new NotFoundException('Зону не знайдено'); t.zone=z; } Object.assign(t, Object.fromEntries(Object.entries(dto).filter(([k])=>k!=='zoneId'))); return this.tables.save(t); }
  async setStatus(id:string,status:TableStatus){ const t=await this.tables.findOne({where:{id}}); if(!t) throw new NotFoundException('Стіл не знайдено'); t.status=status; return this.tables.save(t); }
  markOccupied(id:string){ return this.setStatus(id,'occupied'); }
  markFree(id:string){ return this.setStatus(id,'free'); }
  close(id:string){ return this.setStatus(id,'closed'); }
  async remove(id:string){ const t=await this.tables.findOne({where:{id}}); if(!t) throw new NotFoundException('Стіл не знайдено'); await this.tables.remove(t); return {message:'Стіл видалено'}; }
}
