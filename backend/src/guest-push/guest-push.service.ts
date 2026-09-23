import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { RegisterGuestPushSubscriptionDto } from './dto/register-guest-push-subscription.dto';
import { GuestPushSubscription } from './entities/guest-push-subscription.entity';

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);
const VAPID_PUBLIC_KEY = /^B[A-Za-z0-9_-]{86}$/;

export function hashGuestPushValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function guestPushKyivDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  const year = value('year');
  const month = value('month');
  const day = value('day');

  if (!year || !month || !day) {
    throw new Error('Could not determine the current Kyiv date');
  }

  return `${year}-${month}-${day}`;
}

export function resolveGuestPushConfig(enabledValue?: string, publicKeyValue?: string) {
  const publicKey = String(publicKeyValue || '').trim();
  const enabled =
    String(enabledValue || '').trim().toLowerCase() === 'true' &&
    VAPID_PUBLIC_KEY.test(publicKey);

  return enabled
    ? { enabled: true, vapidPublicKey: publicKey }
    : { enabled: false };
}

@Injectable()
export class GuestPushService {
  constructor(
    @InjectRepository(GuestPushSubscription)
    private readonly subscriptions: Repository<GuestPushSubscription>,
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    private readonly configService: ConfigService,
  ) {}

  config() {
    return resolveGuestPushConfig(
      this.configService.get<string>('GUEST_PUSH_ENABLED'),
      this.configService.get<string>('GUEST_PUSH_VAPID_PUBLIC_KEY'),
    );
  }

  async register(dto: RegisterGuestPushSubscriptionDto) {
    if (!this.config().enabled) {
      throw new ServiceUnavailableException('Push-сповіщення ще не увімкнені');
    }

    const bookingId = String(dto.bookingId || '').trim();
    const guestAccessToken = String(dto.guestAccessToken || '').trim();
    const guestDeviceId = String(dto.guestDeviceId || '').trim();

    if (!bookingId || !guestAccessToken || !guestDeviceId) {
      throw new UnauthorizedException('Недійсний доступ до бронювання');
    }

    const endpoint = String(dto.subscription?.endpoint || '').trim();
    const p256dh = String(dto.subscription?.keys?.p256dh || '').trim();
    const auth = String(dto.subscription?.keys?.auth || '').trim();

    let endpointUrl: URL;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      throw new BadRequestException('Некоректна Push-підписка');
    }

    if (
      endpointUrl.protocol !== 'https:' ||
      !endpointUrl.hostname ||
      endpointUrl.username ||
      endpointUrl.password ||
      endpointUrl.hash ||
      !p256dh ||
      !auth
    ) {
      throw new BadRequestException('Некоректна Push-підписка');
    }

    const tokenHash = hashGuestPushValue(guestAccessToken);
    const guestDeviceIdHash = hashGuestPushValue(guestDeviceId);
    const endpointHash = hashGuestPushValue(endpoint);

    await this.bookings.manager.transaction(async (manager) => {
      const bookingRepository = manager.getRepository(Booking);
      const booking = await bookingRepository
        .createQueryBuilder('booking')
        .addSelect('booking.guestDeviceIdHash')
        .where('booking.id = :bookingId', { bookingId })
        .andWhere('booking.guestAccessTokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write', undefined, ['booking'])
        .getOne();

      if (!booking) {
        throw new UnauthorizedException('Недійсний доступ до бронювання');
      }
      if (
        !ACTIVE_BOOKING_STATUSES.has(booking.status) ||
        booking.bookingDate < guestPushKyivDate()
      ) {
        throw new BadRequestException('Сповіщення для цієї броні вже недоступні');
      }
      if (
        booking.guestDeviceIdHash &&
        booking.guestDeviceIdHash !== guestDeviceIdHash
      ) {
        throw new UnauthorizedException('Недійсний доступ до бронювання');
      }

      await manager.getRepository(GuestPushSubscription).upsert(
        {
          bookingId,
          endpointHash,
          guestDeviceIdHash,
          endpoint,
          p256dh,
          auth,
        },
        {
          conflictPaths: ['bookingId', 'endpointHash'],
          skipUpdateIfNoValuesChanged: true,
        },
      );
    });

    return { enabled: true };
  }
}
