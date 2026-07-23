import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { LogsService } from '../logs/logs.service';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly repo: Repository<Client>,
    private readonly logs: LogsService,
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

  blacklist(id: string, reason: string, actor?: AuthUser) {
    return this.setBlacklist(id, true, reason, actor);
  }

  unblacklist(id: string, reason: string, actor?: AuthUser) {
    return this.setBlacklist(id, false, reason, actor);
  }

  private async setBlacklist(
    id: string,
    isBlacklisted: boolean,
    reason: string,
    actor?: AuthUser,
  ) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');

    client.isBlacklisted = isBlacklisted;
    const saved = await this.repo.save(client);

    await this.logs.create(
      isBlacklisted
        ? 'Гостя додано до чорного списку'
        : 'Гостя прибрано з чорного списку',
      null,
      {
        clientId: client.id,
        clientName: client.fullName,
        clientPhone: client.phone,
        reason: reason.trim(),
        actorRole: actor?.role || null,
        actorName: actor?.name || null,
        actorStaffId: actor?.staffId || null,
      },
    );

    return saved;
  }
}
