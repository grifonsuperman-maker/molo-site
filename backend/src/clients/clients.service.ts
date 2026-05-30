import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { UpdateClientDto } from './dto/update-client.dto';
@Injectable()
export class ClientsService {
  constructor(@InjectRepository(Client) private readonly repo: Repository<Client>) {}
  findAll(){ return this.repo.find({ order:{ visitsCount:'DESC', createdAt:'DESC' }}); }
  async findOne(id:string){ const c=await this.repo.findOne({where:{id}, relations:['bookings','bookings.table']}); if(!c) throw new NotFoundException('Клієнта не знайдено'); return c; }
  async update(id:string,dto:UpdateClientDto){ const c=await this.repo.findOne({where:{id}}); if(!c) throw new NotFoundException('Клієнта не знайдено'); Object.assign(c,dto); return this.repo.save(c); }
  async blacklist(id:string){ return this.update(id,{isBlacklisted:true}); }
  async unblacklist(id:string){ return this.update(id,{isBlacklisted:false}); }
}
