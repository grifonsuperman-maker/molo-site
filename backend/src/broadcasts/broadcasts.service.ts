import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Broadcast } from './entities/broadcast.entity';
import { Client } from '../clients/entities/client.entity';
import { LogsService } from '../logs/logs.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
@Injectable()
export class BroadcastsService {
  constructor(@InjectRepository(Broadcast) private readonly broadcasts:Repository<Broadcast>, @InjectRepository(Client) private readonly clients:Repository<Client>, private readonly logs:LogsService) {}
  findAll(){ return this.broadcasts.find({relations:['createdByStaff'], order:{createdAt:'DESC'}}); }
  async create(dto:CreateBroadcastDto){ if(!dto.message.trim()) throw new BadRequestException('Текст розсилки не може бути порожнім'); const b=await this.broadcasts.save(this.broadcasts.create({title:dto.title||null,message:dto.message,target:dto.target,sentAt:null})); await this.logs.create('Створено розсилку', null, {broadcastId:b.id,target:b.target}); return b; }
  async send(id:string){ const b=await this.broadcasts.findOne({where:{id}}); if(!b) throw new NotFoundException('Розсилку не знайдено'); if(b.sentAt) throw new BadRequestException('Цю розсилку вже було відправлено'); const clients=await this.getTargetClients(b.target); b.sentAt=new Date(); await this.broadcasts.save(b); await this.logs.create('Розсилку відправлено', null, {broadcastId:b.id, clientsCount:clients.length}); return {message:'Розсилку відправлено', clientsCount:clients.length}; }
  async getTargetClients(target:string){ if(target==='all_clients') return this.clients.find({where:{isBlacklisted:false}}); if(target==='regular_clients') return this.clients.find({where:{isRegular:true,isBlacklisted:false}}); if(target==='recent_clients'){ const d=new Date(); d.setDate(d.getDate()-30); return this.clients.find({where:{isBlacklisted:false,lastVisitAt:MoreThanOrEqual(d)}}); } return []; }
}
