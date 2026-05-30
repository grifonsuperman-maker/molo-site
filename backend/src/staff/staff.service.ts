import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Staff } from './entities/staff.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
@Injectable()
export class StaffService {
  constructor(@InjectRepository(Staff) private readonly repo: Repository<Staff>) {}
  findAll(){ return this.repo.find({ order:{ createdAt:'DESC' }}); }
  create(dto:CreateStaffDto){ return this.repo.save(this.repo.create({...dto, telegramId:dto.telegramId||null, phone:dto.phone||null, active:true})); }
  async update(id:string,dto:UpdateStaffDto){ const s=await this.repo.findOne({where:{id}}); if(!s) throw new NotFoundException('Співробітника не знайдено'); Object.assign(s,dto); return this.repo.save(s); }
  async setActive(id:string, active:boolean){ const s=await this.repo.findOne({where:{id}}); if(!s) throw new NotFoundException('Співробітника не знайдено'); s.active=active; return this.repo.save(s); }
  async remove(id:string){ const s=await this.repo.findOne({where:{id}}); if(!s) throw new NotFoundException('Співробітника не знайдено'); await this.repo.remove(s); return {message:'Співробітника видалено'}; }
}
