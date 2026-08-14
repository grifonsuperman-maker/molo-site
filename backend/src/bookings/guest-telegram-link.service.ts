import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Client } from '../clients/entities/client.entity';
import { Booking } from './entities/booking.entity';

@Injectable()
export class GuestTelegramLinkService {
  constructor(private readonly dataSource: DataSource) {}

  async link(bookingId: string, guestToken: string, user: AuthUser) {
    const telegramId = this.verifiedGuestTelegramId(user);
    const guestAccessTokenHash = this.hashToken(guestToken);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const booking = await manager
          .getRepository(Booking)
          .createQueryBuilder('booking')
          .leftJoinAndSelect('booking.client', 'client')
          .where('booking.id = :bookingId', { bookingId })
          .andWhere('booking.guestAccessTokenHash = :guestAccessTokenHash', {
            guestAccessTokenHash,
          })
          .setLock('pessimistic_write', undefined, ['booking'])
          .getOne();

        if (!booking?.client?.id) {
          throw new UnauthorizedException('Недійсний доступ до бронювання');
        }

        const clients = manager.getRepository(Client);
        const client = await clients
          .createQueryBuilder('client')
          .where('client.id = :clientId', { clientId: booking.client.id })
          .setLock('pessimistic_write')
          .getOne();

        if (!client) {
          throw new UnauthorizedException('Недійсний доступ до бронювання');
        }

        if (client.telegramId && client.telegramId !== telegramId) {
          throw new ConflictException(
            'Цей гість уже прив’язаний до іншого Telegram',
          );
        }

        const linkedClient = await clients.findOne({ where: { telegramId } });
        if (linkedClient && linkedClient.id !== client.id) {
          throw new ConflictException(
            'Цей Telegram уже прив’язаний до іншого гостя',
          );
        }

        if (client.telegramId !== telegramId) {
          client.telegramId = telegramId;
          await clients.save(client);
        }

        return {
          message: 'Telegram гостя прив’язано',
          linked: true,
        };
      });
    } catch (error: any) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      if ((error?.code || error?.driverError?.code) === '23505') {
        throw new ConflictException(
          'Цей Telegram уже прив’язаний до іншого гостя',
        );
      }

      throw error;
    }
  }

  private verifiedGuestTelegramId(user: AuthUser) {
    const telegramId = String(user?.telegramId || '').trim();
    if (user?.role !== 'guest' || !/^\d{1,20}$/.test(telegramId)) {
      throw new UnauthorizedException('Потрібна авторизація гостя через Telegram');
    }
    return telegramId;
  }

  private hashToken(token: string) {
    const normalized = String(token || '').trim();
    if (!normalized || normalized.length > 256) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }
    return createHash('sha256').update(normalized).digest('hex');
  }
}
