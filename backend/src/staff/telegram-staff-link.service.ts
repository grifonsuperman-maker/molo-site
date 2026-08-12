import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';

import {
  DEFAULT_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  verifyTelegramInitData,
} from '../auth/telegram-init-data';
import type { AuthUser } from '../auth/types/auth-user.type';
import { TelegramService } from '../notifications/telegram.service';
import type { ConfirmTelegramStaffLinkDto } from './dto/telegram-staff-link.dto';
import { Staff } from './entities/staff.entity';

const TELEGRAM_INVITE_TTL_MS = 30 * 60 * 1000;
const TELEGRAM_INVITE_PREFIX = 'staff_';

@Injectable()
export class TelegramStaffLinkService {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,
    private readonly jwtService: JwtService,
    private readonly telegram: TelegramService,
  ) {}

  async createInvite(staffId: string) {
    const staff = await this.getStaffOrThrow(staffId);

    if (!staff.active || staff.isArchived) {
      throw new BadRequestException(
        'Telegram можна прив’язати лише активному працівнику',
      );
    }

    if (staff.telegramId) {
      throw new BadRequestException(
        'Telegram уже прив’язаний до цього працівника',
      );
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + TELEGRAM_INVITE_TTL_MS);

    staff.telegramInviteTokenHash = this.hashToken(token);
    staff.telegramInviteExpiresAt = expiresAt;
    await this.staffRepo.save(staff);

    const botUsername = await this.telegram.getBotUsername();

    return {
      inviteUrl: `https://t.me/${botUsername}?startapp=${TELEGRAM_INVITE_PREFIX}${token}`,
      expiresAt: expiresAt.toISOString(),
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        role: staff.role,
      },
    };
  }

  async getInviteInfo(token: string) {
    const staff = await this.resolveInvite(token);

    return {
      fullName: staff.fullName,
      role: staff.role,
      authType: staff.role === 'owner' ? 'director_password' : 'pin',
      expiresAt: staff.telegramInviteExpiresAt?.toISOString() || null,
    };
  }

  async confirmInvite(dto: ConfirmTelegramStaffLinkDto) {
    const telegramUser = this.verifyTelegramUser(dto.initData);
    const staffForCredentialCheck = await this.resolveInvite(dto.token);
    await this.assertCredential(staffForCredentialCheck, dto);

    const saved = await this.consumeInviteAtomically(dto.token, telegramUser.id);
    const payload: AuthUser = {
      sub: saved.id,
      telegramId: telegramUser.id,
      staffId: saved.id,
      role: saved.role,
      name: saved.fullName,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: payload,
    };
  }

  async findActiveStaffByTelegramId(telegramId: string) {
    if (!telegramId) return null;

    return this.staffRepo.findOne({
      where: {
        telegramId,
        active: true,
        isArchived: false,
      },
    });
  }

  private async consumeInviteAtomically(rawToken: string, telegramId: string) {
    const token = this.normalizeToken(rawToken);
    const tokenHash = this.hashToken(token);

    try {
      return await this.staffRepo.manager.transaction(async (manager) => {
        const staff = await manager
          .getRepository(Staff)
          .createQueryBuilder('staff')
          .setLock('pessimistic_write')
          .where('staff.telegram_invite_token_hash = :tokenHash', { tokenHash })
          .getOne();

        this.assertInviteUsable(staff);

        const alreadyLinked = await manager.getRepository(Staff).findOne({
          where: { telegramId },
        });

        if (alreadyLinked && alreadyLinked.id !== staff.id) {
          throw new ConflictException(
            'Цей Telegram уже прив’язаний до іншого працівника',
          );
        }

        staff.telegramId = telegramId;
        staff.telegramInviteTokenHash = null;
        staff.telegramInviteExpiresAt = null;
        return manager.getRepository(Staff).save(staff);
      });
    } catch (error: any) {
      if (error instanceof ConflictException || error instanceof UnauthorizedException) {
        throw error;
      }

      if (error?.code === '23505') {
        throw new ConflictException(
          'Цей Telegram уже прив’язаний до іншого працівника',
        );
      }

      throw error;
    }
  }

  private async resolveInvite(rawToken: string) {
    const token = this.normalizeToken(rawToken);

    if (!token) {
      throw new UnauthorizedException('Посилання для прив’язки недійсне');
    }

    const staff = await this.staffRepo.findOne({
      where: {
        telegramInviteTokenHash: this.hashToken(token),
      },
    });

    if (!staff) {
      throw new UnauthorizedException(
        'Посилання для прив’язки вже використане або недійсне',
      );
    }

    try {
      this.assertInviteUsable(staff);
    } catch (error) {
      if (
        error instanceof UnauthorizedException &&
        (!staff.telegramInviteExpiresAt ||
          staff.telegramInviteExpiresAt.getTime() < Date.now() ||
          staff.telegramId)
      ) {
        staff.telegramInviteTokenHash = null;
        staff.telegramInviteExpiresAt = null;
        await this.staffRepo.save(staff);
      }
      throw error;
    }

    return staff;
  }

  private assertInviteUsable(staff: Staff | null): asserts staff is Staff {
    if (!staff) {
      throw new UnauthorizedException(
        'Посилання для прив’язки вже використане або недійсне',
      );
    }

    if (!staff.active || staff.isArchived) {
      throw new UnauthorizedException('Працівник неактивний');
    }

    if (staff.telegramId) {
      throw new UnauthorizedException('Telegram уже прив’язаний');
    }

    if (
      !staff.telegramInviteExpiresAt ||
      staff.telegramInviteExpiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        'Посилання для прив’язки прострочене. Створіть нове в пульті персоналу',
      );
    }
  }

  private async assertCredential(
    staff: Staff,
    dto: ConfirmTelegramStaffLinkDto,
  ) {
    if (staff.role === 'owner') {
      if (!staff.directorPasswordHash) {
        throw new BadRequestException(
          'Спочатку налаштуйте пароль Директора на сайті',
        );
      }

      if (!dto.password) {
        throw new BadRequestException('Введіть пароль Директора');
      }

      const passwordIsValid = await compare(
        dto.password,
        staff.directorPasswordHash,
      );

      if (!passwordIsValid) {
        throw new UnauthorizedException('Невірний пароль Директора');
      }
      return;
    }

    if (!staff.pinHash) {
      throw new BadRequestException('Для працівника не встановлено PIN');
    }

    if (!dto.pin) {
      throw new BadRequestException('Введіть PIN працівника');
    }

    const pinIsValid = await compare(dto.pin, staff.pinHash);

    if (!pinIsValid) {
      throw new UnauthorizedException('Невірний PIN');
    }
  }

  private verifyTelegramUser(initData: string) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      throw new BadRequestException('TELEGRAM_BOT_TOKEN не налаштовано');
    }

    const configuredMaxAge = Number(
      process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
    );
    const maxAgeSeconds =
      Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
        ? configuredMaxAge
        : DEFAULT_TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;

    try {
      return verifyTelegramInitData(initData, botToken, { maxAgeSeconds });
    } catch (error: any) {
      throw new UnauthorizedException(
        error?.message || 'Telegram авторизація не пройшла перевірку',
      );
    }
  }

  private normalizeToken(value: string) {
    const token = String(value || '').trim();
    return token.startsWith(TELEGRAM_INVITE_PREFIX)
      ? token.slice(TELEGRAM_INVITE_PREFIX.length)
      : token;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async getStaffOrThrow(id: string) {
    const staff = await this.staffRepo.findOne({ where: { id } });

    if (!staff) {
      throw new NotFoundException('Співробітника не знайдено');
    }

    return staff;
  }
}
