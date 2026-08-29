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

  private phoneIdentityKey(phone: string | null | undefined) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (/^0\d{9}$/.test(digits)) return `ua:38${digits}`;
    if (/^380\d{9}$/.test(digits)) return `ua:${digits}`;
    return `phone:${digits || String(phone || '').trim()}`;
  }

  private telegramIdentityCount(clients: Client[]) {
    return new Set(
      clients
        .map((client) => String(client.telegramId || '').trim())
        .filter(Boolean),
    ).size;
  }

  private canonicalClient(clients: Client[]) {
    const sorted = [...clients].sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id).localeCompare(String(right.id));
    });
    return sorted.find((client) => Boolean(client.telegramId)) || sorted[0];
  }

  private projectEquivalentClients(clients: Client[], includeBookings = false) {
    const canonical = this.canonicalClient(clients);
    const lastVisitAt = clients.reduce<Date | null>((latest, client) => {
      if (!client.lastVisitAt) return latest;
      if (!latest || client.lastVisitAt.getTime() > latest.getTime()) {
        return client.lastVisitAt;
      }
      return latest;
    }, null);
    const blacklisted = [...clients]
      .filter((client) => client.isBlacklisted)
      .sort((left, right) => {
        const leftTime = left.blacklistedAt?.getTime() || 0;
        const rightTime = right.blacklistedAt?.getTime() || 0;
        return rightTime - leftTime;
      })[0];
    const notes = Array.from(
      new Set(
        clients
          .map((client) => String(client.note || '').trim())
          .filter(Boolean),
      ),
    );

    return {
      ...canonical,
      visitsCount: clients.reduce(
        (sum, client) => sum + Number(client.visitsCount || 0),
        0,
      ),
      totalGuests: clients.reduce(
        (sum, client) => sum + Number(client.totalGuests || 0),
        0,
      ),
      cancellationsCount: clients.reduce(
        (sum, client) => sum + Number(client.cancellationsCount || 0),
        0,
      ),
      reschedulesCount: clients.reduce(
        (sum, client) => sum + Number(client.reschedulesCount || 0),
        0,
      ),
      lastVisitAt,
      note: notes.length ? notes.join('\n') : null,
      isRegular: clients.some((client) => client.isRegular),
      isBlacklisted: Boolean(blacklisted),
      blacklistReason: blacklisted?.blacklistReason || null,
      blacklistedAt: blacklisted?.blacklistedAt || null,
      ...(includeBookings
        ? {
            bookings: clients.flatMap((client) => client.bookings || []),
          }
        : {}),
    };
  }

  private async writableIdentityGroup(id: string) {
    const requested = await this.repo.findOne({ where: { id } });
    if (!requested) throw new NotFoundException('Клієнта не знайдено');

    const clients = await this.repo.find({ order: { createdAt: 'ASC' } });
    const key = this.phoneIdentityKey(requested.phone);
    const equivalents = clients.filter(
      (client) => this.phoneIdentityKey(client.phone) === key,
    );

    if (
      equivalents.length <= 1 ||
      this.telegramIdentityCount(equivalents) > 1
    ) {
      return [requested];
    }

    return equivalents;
  }

  async findAll() {
    const clients = await this.repo.find({ order: { createdAt: 'ASC' } });
    const groups = new Map<string, Client[]>();

    for (const client of clients) {
      const key = this.phoneIdentityKey(client.phone);
      const group = groups.get(key) || [];
      group.push(client);
      groups.set(key, group);
    }

    const visible = Array.from(groups.values()).flatMap((group) => {
      if (group.length === 1 || this.telegramIdentityCount(group) > 1) {
        return group;
      }
      return [this.projectEquivalentClients(group)];
    });

    return visible.sort((left, right) => {
      if (right.visitsCount !== left.visitsCount) {
        return right.visitsCount - left.visitsCount;
      }
      return (
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime()
      );
    });
  }

  async findOne(id: string) {
    const clients = await this.repo.find({
      relations: ['bookings', 'bookings.table'],
      order: { createdAt: 'ASC' },
    });
    const requested = clients.find((client) => client.id === id);
    if (!requested) throw new NotFoundException('Клієнта не знайдено');

    const key = this.phoneIdentityKey(requested.phone);
    const equivalents = clients.filter(
      (client) => this.phoneIdentityKey(client.phone) === key,
    );
    if (
      equivalents.length === 1 ||
      this.telegramIdentityCount(equivalents) > 1
    ) {
      return requested;
    }

    return this.projectEquivalentClients(equivalents, true);
  }

  async update(id: string, dto: UpdateClientDto) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    Object.assign(client, dto);
    return this.repo.save(client);
  }

  async blacklist(id: string, reason: string) {
    const clients = await this.writableIdentityGroup(id);
    const blacklistedAt = new Date();

    for (const client of clients) {
      client.isBlacklisted = true;
      client.blacklistReason = reason.trim();
      client.blacklistedAt = blacklistedAt;
      await this.repo.save(client);
    }

    return clients.find((client) => client.id === id) || clients[0];
  }

  async unblacklist(id: string) {
    const clients = await this.writableIdentityGroup(id);

    for (const client of clients) {
      client.isBlacklisted = false;
      client.blacklistReason = null;
      client.blacklistedAt = null;
      await this.repo.save(client);
    }

    return clients.find((client) => client.id === id) || clients[0];
  }
}
