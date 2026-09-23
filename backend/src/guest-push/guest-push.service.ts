import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createECDH, createHash } from 'crypto';
import { Repository } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { RegisterGuestPushSubscriptionDto } from './dto/register-guest-push-subscription.dto';
import { GuestPushSubscription } from './entities/guest-push-subscription.entity';
import {
  GuestPushTransport,
  type GuestPushVapidCredentials,
} from './guest-push.transport';

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);
const VAPID_PUBLIC_KEY = /^B[A-Za-z0-9_-]{86}$/;
const VAPID_PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;
const MAX_PUSH_BODY_LENGTH = 500;

export type GuestPushDeliverySummary = {
  attempted: number;
  delivered: number;
  failed: number;
};

function isValidVapidSubject(value: string) {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' && Boolean(parsed.hostname)) ||
      (parsed.protocol === 'mailto:' && Boolean(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function isMatchingVapidKeyPair(publicKey: string, privateKey: string) {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return ecdh.getPublicKey().toString('base64url') === publicKey;
  } catch {
    return false;
  }
}

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

export function resolveGuestPushConfig(
  enabledValue?: string,
  publicKeyValue?: string,
  privateKeyValue?: string,
  subjectValue?: string,
) {
  const publicKey = String(publicKeyValue || '').trim();
  const privateKey = String(privateKeyValue || '').trim();
  const subject = String(subjectValue || '').trim();
  const enabled =
    String(enabledValue || '').trim().toLowerCase() === 'true' &&
    VAPID_PUBLIC_KEY.test(publicKey) &&
    VAPID_PRIVATE_KEY.test(privateKey) &&
    isValidVapidSubject(subject) &&
    isMatchingVapidKeyPair(publicKey, privateKey);

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
    private readonly transport: GuestPushTransport,
  ) {}

  config() {
    return resolveGuestPushConfig(
      this.configService.get<string>('GUEST_PUSH_ENABLED'),
      this.configService.get<string>('GUEST_PUSH_VAPID_PUBLIC_KEY'),
      this.configService.get<string>('GUEST_PUSH_VAPID_PRIVATE_KEY'),
      this.configService.get<string>('GUEST_PUSH_VAPID_SUBJECT'),
    );
  }

  private deliveryCredentials(): GuestPushVapidCredentials | null {
    if (!this.config().enabled) return null;

    return {
      publicKey: String(
        this.configService.get<string>('GUEST_PUSH_VAPID_PUBLIC_KEY') || '',
      ).trim(),
      privateKey: String(
        this.configService.get<string>('GUEST_PUSH_VAPID_PRIVATE_KEY') || '',
      ).trim(),
      subject: String(
        this.configService.get<string>('GUEST_PUSH_VAPID_SUBJECT') || '',
      ).trim(),
    };
  }

  async sendBookingNotification(
    bookingIdValue: string,
    bodyValue: string,
  ): Promise<GuestPushDeliverySummary> {
    const credentials = this.deliveryCredentials();
    const bookingId = String(bookingIdValue || '').trim();
    const body = String(bodyValue || '').trim().slice(0, MAX_PUSH_BODY_LENGTH);

    if (!credentials || !bookingId || !body) {
      return { attempted: 0, delivered: 0, failed: 0 };
    }

    const subscriptions = await this.subscriptions.find({
      where: { bookingId },
    });
    if (subscriptions.length === 0) {
      return { attempted: 0, delivered: 0, failed: 0 };
    }

    const payload = JSON.stringify({
      category: 'booking',
      body,
    });

    const results = await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await this.transport.send(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
            credentials,
          );
          return true;
        } catch (error) {
          const statusCode = this.deliveryStatusCode(error);
          if (statusCode === 404 || statusCode === 410) {
            try {
              await this.subscriptions.delete({
                bookingId: subscription.bookingId,
                endpointHash: subscription.endpointHash,
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              });
            } catch (cleanupError) {
              console.warn('Guest Push stale subscription cleanup failed', {
                bookingId,
                statusCode,
                errorName:
                  cleanupError instanceof Error
                    ? cleanupError.name
                    : 'UnknownError',
              });
            }
          }

          console.warn('Guest Push delivery failed', {
            bookingId,
            statusCode,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          return false;
        }
      }),
    );

    const delivered = results.filter(Boolean).length;
    return {
      attempted: results.length,
      delivered,
      failed: results.length - delivered,
    };
  }

  private deliveryStatusCode(error: unknown) {
    const value = error as {
      statusCode?: unknown;
      status?: unknown;
      response?: { statusCode?: unknown; status?: unknown };
    };
    const candidates = [
      value?.statusCode,
      value?.status,
      value?.response?.statusCode,
      value?.response?.status,
    ];
    const status = candidates
      .map((candidate) => Number(candidate))
      .find((candidate) => Number.isInteger(candidate));

    return status || null;
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
