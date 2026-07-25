import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly repo: Repository<Client>,
  ) {}

  findAll() {
    return this.repo.find({ order: { visitsCount: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const client = await this.repo.findOne({
      where: { id },
      relations: ['bookings', 'bookings.table'],
    });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    Object.assign(client, dto);
    return this.repo.save(client);
  }

  async blacklist(id: string, reason: string) {
    const client = await this.findOne(id);
    client.isBlacklisted = true;
    client.blacklistReason = reason.trim();
    client.blacklistedAt = new Date();
    return this.repo.save(client);
  }

  async unblacklist(id: string) {
    const client = await this.findOne(id);
    client.isBlacklisted = false;
    client.blacklistReason = null;
    client.blacklistedAt = null;
    return this.repo.save(client);
  }
}
