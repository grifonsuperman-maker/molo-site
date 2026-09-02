import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TelegramAdminBookingCreateService } from './telegram-admin-booking-create.service';
import { TelegramAdminMenuService } from './telegram-admin-menu.service';

export const BASE_TELEGRAM_ADMIN_MENU = 'BASE_TELEGRAM_ADMIN_MENU';

@Injectable()
export class TelegramAdminMenuBookingFacadeService {
  constructor(
    @Inject(BASE_TELEGRAM_ADMIN_MENU)
    private readonly baseMenu: TelegramAdminMenuService,
    private readonly bookingCreate: TelegramAdminBookingCreateService,
  ) {}

  hasPendingInput(telegramId: string) {
    return (
      this.bookingCreate.hasPendingInput(telegramId) ||
      this.baseMenu.hasPendingInput(telegramId)
    );
  }

  clearPendingInput(telegramId: string) {
    this.bookingCreate.clearPendingInput(telegramId);
    this.baseMenu.clearPendingInput(telegramId);
  }

  async sendMenu(
    chatId: string | number,
    actor: AuthUser,
    adminAppUrl?: string | null,
  ) {
    await this.baseMenu.sendMenu(chatId, actor, adminAppUrl);
    await this.bookingCreate.sendEntry(chatId);
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
    adminAppUrl?: string | null,
  ) {
    if (actor && action === 'booking' && this.isBookingCreateAction(id)) {
      this.baseMenu.clearPendingInput(this.actorKey(actor));
      return this.bookingCreate.handleAction(id, chatId, actor);
    }

    if (actor && action === 'broadcast') {
      this.bookingCreate.clearPendingInput(this.actorKey(actor));
    }

    return this.baseMenu.handle(action, id, chatId, actor, adminAppUrl);
  }

  async handleText(text: string, chatId: string | number, actor: AuthUser) {
    const key = this.actorKey(actor);
    if (this.bookingCreate.hasPendingInput(key)) {
      return this.bookingCreate.handleText(text, chatId, actor);
    }
    return this.baseMenu.handleText(text, chatId, actor);
  }

  private isBookingCreateAction(id: string | undefined) {
    return id === 'create' || Boolean(id?.startsWith('create_'));
  }

  private actorKey(actor: AuthUser) {
    return String(actor.telegramId || actor.staffId || actor.sub || '').trim();
  }
}
