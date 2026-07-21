import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Staff } from '../staff/entities/staff.entity';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { AuthRole, AuthUser } from './types/auth-user.type';
import { verifyTelegramInitData } from './telegram-init-data';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,

    private readonly jwtService: JwtService,
  ) {}

  async authenticateTelegram(dto: TelegramAuthDto) {
    const telegramUser = this.resolveTelegramUser(dto);

    const staff = await this.staffRepo.findOne({
      where: { telegramId: telegramUser.telegramId, active: true, isArchived: false },
    });

    const role: AuthRole = staff?.role || 'guest';

    const payload: AuthUser = {
      sub: staff?.id || telegramUser.telegramId,
      telegramId: telegramUser.telegramId,
      staffId: staff?.id || null,
      role,
      name: staff?.fullName || telegramUser.name,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: payload,
    };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const payload = await this.jwtService.verifyAsync<AuthUser>(token, {
        secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      });
      if (!payload.staffId) return payload;

      const staff = await this.staffRepo.findOne({ where: { id: payload.staffId } });
      if (!staff || !staff.active || staff.isArchived) {
        throw new UnauthorizedException('Працівник заблокований або архівований');
      }
      if ((staff.role === 'waiter' || staff.role === 'hookah') && !staff.isOnShift) {
        throw new UnauthorizedException('Зміну працівника завершено');
      }
      return {
        ...payload,
        role: staff.role,
        name: staff.fullName,
      };
    } catch {
      throw new UnauthorizedException('Недійсний токен авторизації');
    }
  }

  private resolveTelegramUser(dto: TelegramAuthDto): { telegramId: string; name: string | null } {
    if (dto.initData) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        throw new BadRequestException('TELEGRAM_BOT_TOKEN не налаштовано');
      }

      try {
        const user = verifyTelegramInitData(dto.initData, botToken);
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null;

        return {
          telegramId: user.id,
          name,
        };
      } catch (error: any) {
        throw new UnauthorizedException(error?.message || 'Telegram авторизація не пройшла перевірку');
      }
    }

    if (process.env.ALLOW_DEV_AUTH === 'true' && dto.devTelegramId) {
      return {
        telegramId: dto.devTelegramId,
        name: dto.devName || 'Dev User',
      };
    }

    throw new BadRequestException('initData Telegram відсутній');
  }
}
