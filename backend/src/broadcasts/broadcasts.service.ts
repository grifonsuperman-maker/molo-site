import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { LogsService } from '../logs/logs.service';
import { TelegramService } from '../notifications/telegram.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { Broadcast } from './entities/broadcast.entity';

@Injectable()
export class BroadcastsService {
  constructor(
    @InjectRepository(Broadcast)
    private readonly broadcasts: Repository<Broadcast>,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
    private readonly logs: LogsService,
    private readonly telegram: TelegramService,
  ) {}

  findAll() {
    return this.broadcasts.find({ relations: ['createdByStaff'], order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateBroadcastDto) {
    const message = this.normalizeMessage(dto.message);
    const broadcast = await this.broadcasts.save(
      this.broadcasts.create({
        title: dto.title || null,
        message,
        target: dto.target,
        sentAt: null,
      }),
    );
    await this.logs.create('Створено розсилку', null, {
      broadcastId: broadcast.id,
      target: broadcast.target,
    });
    return broadcast;
  }

  async sendNow(dto: CreateBroadcastDto) {
    const message = this.normalizeMessage(dto.message);
    const recipients = await this.getTargetClients(dto.target, dto.clientIds);
    if (!recipients.length) {
      throw new BadRequestException('Оберіть хоча б одного доступного гостя');
    }

    const broadcast = await this.broadcasts.save(
      this.broadcasts.create({
        title: dto.title || null,
        message,
        target: dto.target,
        sentAt: new Date(),
      }),
    );
    const result = await this.deliver(recipients, message);

    await this.logs.create('Розсилку відправлено', null, {
      broadcastId: broadcast.id,
      target: dto.target,
      recipientCount: recipients.length,
      deliveredCount: result.deliveredCount,
      unreachableCount: result.unreachableCount,
    });

    return {
      message: 'Розсилку оброблено',
      recipientCount: recipients.length,
      ...result,
    };
  }

  async send(id: string) {
    const broadcast = await this.broadcasts.findOne({ where: { id } });
    if (!broadcast) throw new NotFoundException('Розсилку не знайдено');
    if (broadcast.sentAt) throw new BadRequestException('Цю розсилку вже було відправлено');

    const recipients = await this.getTargetClients(broadcast.target);
    if (!recipients.length) throw new BadRequestException('Немає доступних отримувачів');

    const result = await this.deliver(recipients, broadcast.message);
    broadcast.sentAt = new Date();
    await this.broadcasts.save(broadcast);
    await this.logs.create('Розсилку відправлено', null, {
      broadcastId: broadcast.id,
      recipientCount: recipients.length,
      deliveredCount: result.deliveredCount,
      unreachableCount: result.unreachableCount,
    });

    return {
      message: 'Розсилку оброблено',
      recipientCount: recipients.length,
      ...result,
    };
  }

  async getTargetClients(target: string, clientIds: string[] = []) {
    if (target === 'all_clients') {
      return this.clients.find({ where: { isBlacklisted: false } });
    }
    if (target === 'regular_clients') {
      return this.clients.find({ where: { isRegular: true, isBlacklisted: false } });
    }
    if (target === 'recent_clients') {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      return this.clients.find({ where: { isBlacklisted: false, lastVisitAt: MoreThanOrEqual(date) } });
    }
    if (target === 'selected_clients') {
      const ids = [...new Set(clientIds.map((id) => String(id || '').trim()).filter(Boolean))];
      if (!ids.length) return [];
      return this.clients.find({ where: { id: In(ids), isBlacklisted: false } });
    }
    return [];
  }

  private normalizeMessage(value: string) {
    const message = String(value || '').trim();
    if (!message) throw new BadRequestException('Текст розсилки не може бути порожнім');
    if (message.length > 3500) throw new BadRequestException('Повідомлення занадто довге');
    return message;
  }

  private async deliver(recipients: Client[], message: string) {
    const reachable = recipients.filter((client) => Boolean(client.telegramId));
    const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const attempts = await Promise.allSettled(
      reachable.map((client) => this.telegram.sendMessage(client.telegramId as string, escaped)),
    );
    const deliveredCount = attempts.filter((attempt) => attempt.status === 'fulfilled').length;
    return {
      deliveredCount,
      unreachableCount: recipients.length - deliveredCount,
    };
  }
}
