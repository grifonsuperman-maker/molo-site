import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Log } from './entities/log.entity';
import { Staff } from '../staff/entities/staff.entity';

@Injectable()
export class LogsService {
  constructor(@InjectRepository(Log) private readonly logsRepo: Repository<Log>) {}
  findAll() { return this.logsRepo.find({ relations: ['staff'], order: { createdAt: 'DESC' }, take: 300 }); }
  create(action: string, staff?: Staff | null, details?: Record<string, unknown>) {
    return this.logsRepo.save(this.logsRepo.create({ action, staff: staff || null, details: details || null }));
  }
}
