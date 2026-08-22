import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { BookingRescheduleApprovalService } from '../bookings/booking-reschedule-approval.service';
import { BookingsService } from '../bookings/bookings.service';
import { TelegramService } from '../notifications/telegram.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import type { StaffRole } from '../staff/entities/staff.entity';
import { TelegramStaffLinkService } from '../staff/telegram-staff-link.service';
import { TelegramAdminMenuService } from './telegram-admin-menu.service';
import { TelegramHookahMenuService } from './telegram-hookah-menu.service';
import { TelegramWaiterMenuService } from './telegram-waiter-menu.service';

type CallbackRoleRule = {
  roles: StaffRole[];
  requiresShift?: boolean;
};

type CallbackAuthorization = {
  role: StaffRole | 'unprotected';
  actor: AuthUser | null;
};

const WAITER_CALLBACK_ACTIONS = [
  'calls',
  'call',
  'call_accept',
  'call_close',
  'mine',
  'bookings',
  'history',
  'booking',
  'booking_checkin',
  'booking_cleaning',
  'booking_complete',
  'tables',
  'zone',
  'table',
  'table_occupied',
  'table_free',
] as const;

const HOOKAH_CALLBACK_ACTIONS = [
  'calls',
  'call',
  'accept_5',
  'accept_10',
  'accept_20',
  'accept_30',
  'mine',
  'mine_call',
  'complete',
  'availability_on',
  'availability_off',
] as const;

const ADMIN_CALLBACK_ACTIONS = [
  'bookings',
  'booking',
  'booking_approve',
  'booking_reject',
  'booking_checkin',
  'booking_complete',
  'reschedules',
  'reschedule',
  'reschedule_approve',
  'reschedule_reject',
  'attention',
  'attention_item',
  'reviews',
  'locations',
  'location',
  'table',
  'broadcast',
  'broadcast_confirm',
  'broadcast_cancel',
  'restaurant',
  'restaurant_open',
  'booking_open',
  'booking_close',
  'restaurant_close',
] as const;

const CALLBACK_ROLE_RULES: Record<string, CallbackRoleRule> = {
  'menu:admin': { roles: ['admin', 'owner'] },
  'menu:waiter': {
    roles: ['waiter', 'admin', 'owner'],
    requiresShift: true,
  },
  'menu:hookah': {
    roles: ['hookah'],
    requiresShift: true,
  },
  ...Object.fromEntries(
    WAITER_CALLBACK_ACTIONS.map((action) => [
      `waiter:${action}`,
      { roles: ['waiter'] as StaffRole[], requiresShift: true },
    ]),
  ),
  ...Object.fromEntries(
    HOOKAH_CALLBACK_ACTIONS.map((action) => [
      `hookah:${action}`,
      { roles: ['hookah'] as StaffRole[], requiresShift: true },
    ]),
  ),
  ...Object.fromEntries(
    ADMIN_CALLBACK_ACTIONS.map((action) => [
      `admin:${action}`,
      { roles: ['admin', 'owner'] as StaffRole[] },
    ]),
  ),
  'booking:approve': { roles: ['admin', 'owner'] },
  'booking:reject': { roles: ['admin', 'owner'] },
  'booking:cancel': { roles: ['admin', 'owner'] },
  'booking:checkin': {
    roles: ['waiter', 'admin', 'owner'],
    requiresShift: true,
  },
  'booking:complete': {
    roles: ['waiter', 'admin', 'owner'],
    requiresShift: true,
  },
  'reschedule:approve': { roles: ['admin', 'owner'] },
  'reschedule:reject': { roles: ['admin', 'owner'] },
  'restaurant:open': { roles: ['admin', 'owner'] },
  'restaurant:close_booking': { roles: ['admin', 'owner'] },
  'restaurant:close_full': { roles: ['admin', 'owner'] },
};

@Injectable()
export class TelegramWebhookService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly restaurant: RestaurantService,
    private readonly telegram: TelegramService,
    private readonly telegramStaff: TelegramStaffLinkService,
    private readonly waiterMenu?: TelegramWaiterMenuService,
    private readonly hookahMenu?: TelegramHookahMenuService,
    private readonly adminMenu?: TelegramAdminMenuService,
  ) {}

  async handleUpdate(update: any) {
    if (update.callback_query) return this.handleCallback(update.callback_query);
    if (update.message) return this.handleMessage(update.message);
    return { ok: true };
  }

  async handleMessage(message: any) {
    const chatId = message.chat?.id;
    const text = message.text;
    if (!chatId || !text) return { ok: true };
    const telegramId = String(message.from?.id || '');

    if (text === '/start' || text.startsWith('/start ')) {
      const staff = telegramId
        ? await this.telegramStaff.findActiveStaffByTelegramId(telegramId)
        : null;

      if (!staff) {
        const guestAppUrl = this.getWebAppUrl('guest');
        const keyboard = guestAppUrl
          ? {
              inline_keyboard: [
                [
                  {
                    text: '🍽 Відкрити застосунок MOLO',
                    web_app: { url: guestAppUrl },
                  },
                ],
              ],
            }
          : undefined;

        await this.telegram.sendMessage(
          chatId,
          'Вітаємо в MOLO Restaurant 👋',
          keyboard,
        );
        return { ok: true };
      }

      if (staff.role === 'admin' && this.adminMenu) {
        this.adminMenu.clearPendingInput(telegramId);
      }

      const roleMenu = this.staffRoleMenu(staff.role);
      const appUrl = this.getWebAppUrl(roleMenu.mode);
      const rows: Array<Array<Record<string, unknown>>> = [];

      if (staff.role === 'waiter') {
        rows.push([
          {
            text: '👨‍🍳 Команди Офіціанта',
            callback_data: 'menu:waiter',
          },
        ]);
      }

      if (staff.role === 'hookah' && this.hookahMenu) {
        rows.push([
          {
            text: '💨 Команди Кальянника',
            callback_data: 'menu:hookah',
          },
        ]);
      }

      if (staff.role === 'admin' && this.adminMenu) {
        rows.push([
          {
            text: '👔 Команди Адміністратора',
            callback_data: 'menu:admin',
          },
        ]);
      }

      if (appUrl) {
        rows.push([
          {
            text: roleMenu.button,
            web_app: { url: appUrl },
          },
        ]);
      }

      await this.telegram.sendMessage(
        chatId,
        `Вітаємо, ${staff.fullName} 👋\n\n${roleMenu.title}`,
        rows.length ? { inline_keyboard: rows } : undefined,
      );
      return { ok: true };
    }

    if (telegramId && this.adminMenu?.hasPendingInput(telegramId)) {
      const staff = await this.telegramStaff.findActiveStaffByTelegramId(telegramId);
      if (staff && (staff.role === 'admin' || staff.role === 'owner')) {
        const actor = this.toAuthUser(staff, telegramId);
        try {
          const handled = await this.adminMenu.handleText(text, chatId, actor);
          if (handled) return { ok: true };
        } catch (error: any) {
          await this.telegram.sendMessage(
            chatId,
            `⚠️ Помилка: ${error?.message || 'невідома помилка'}`,
          );
          return { ok: false };
        }
      }
    }

    return { ok: true };
  }

  async handleCallback(cb: any) {
    const chatId = cb.message?.chat?.id;
    const data = cb.data as string;
    if (!chatId || !data) return { ok: true };

    if (cb.id) {
      await this.telegram.answerCallbackQuery(cb.id).catch(() => undefined);
    }

    const [type, action, id] = data.split(':');

    try {
      const authorization = await this.getCallbackAuthorization(
        cb.from?.id,
        type,
        action,
      );

      if (!authorization) {
        await this.telegram.sendMessage(
          chatId,
          '⛔ Недостатньо прав для цієї команди. Відкрийте робочий профіль MOLO.',
        );
        return { ok: false };
      }

      const actorRole = authorization.role;
      const actor = authorization.actor;

      if (type === 'menu' && action === 'admin') {
        const adminAppUrl = this.getWebAppUrl('admin');
        if (actor && this.adminMenu) {
          await this.adminMenu.sendMenu(chatId, actor, adminAppUrl);
          return { ok: true };
        }

        const keyboard: Array<Array<Record<string, unknown>>> = [];
        if (adminAppUrl) {
          keyboard.push([
            {
              text: '👔 Відкрити панель адміністратора',
              web_app: { url: adminAppUrl },
            },
          ]);
        }
        keyboard.push(
          [{ text: '🟢 Відкрити ресторан', callback_data: 'restaurant:open' }],
          [
            {
              text: '🔒 Закрити бронювання',
              callback_data: 'restaurant:close_booking',
            },
          ],
          [
            {
              text: '🔴 Закрити ресторан',
              callback_data: 'restaurant:close_full',
            },
          ],
        );
        await this.telegram.sendMessage(chatId, '👔 Панель адміністратора', {
          inline_keyboard: keyboard,
        });
        return { ok: true };
      }

      if (type === 'menu' && action === 'waiter') {
        const waiterAppUrl = this.getWebAppUrl('waiter');

        if (actorRole === 'waiter' && this.waiterMenu) {
          await this.waiterMenu.sendMenu(chatId, waiterAppUrl);
          return { ok: true };
        }

        await this.telegram.sendMessage(
          chatId,
          '👨‍🍳 Панель офіціанта\n\nБронювання на сьогодні доступні в Mini App.',
          waiterAppUrl
            ? {
                inline_keyboard: [
                  [
                    {
                      text: '👨‍🍳 Відкрити панель офіціанта',
                      web_app: { url: waiterAppUrl },
                    },
                  ],
                ],
              }
            : undefined,
        );
        return { ok: true };
      }

      if (type === 'menu' && action === 'hookah') {
        const hookahAppUrl = this.getWebAppUrl('hookah');

        if (actorRole === 'hookah' && actor?.staffId && this.hookahMenu) {
          await this.hookahMenu.sendMenu(
            chatId,
            actor.staffId,
            hookahAppUrl,
          );
          return { ok: true };
        }

        await this.telegram.sendMessage(
          chatId,
          '💨 Панель Кальянника доступна в Mini App.',
          hookahAppUrl
            ? {
                inline_keyboard: [
                  [
                    {
                      text: '💨 Відкрити панель кальянника',
                      web_app: { url: hookahAppUrl },
                    },
                  ],
                ],
              }
            : undefined,
        );
        return { ok: true };
      }

      if (type === 'waiter') {
        if (!this.waiterMenu) {
          throw new Error('Telegram-пульт Офіціанта не підключено');
        }
        const handled = await this.waiterMenu.handle(action, id, chatId, actor);
        if (handled) return { ok: true };
      }

      if (type === 'hookah') {
        if (!this.hookahMenu) {
          throw new Error('Telegram-пульт Кальянника не підключено');
        }
        const handled = await this.hookahMenu.handle(
          action,
          id,
          chatId,
          actor,
          this.getWebAppUrl('hookah'),
        );
        if (handled) return { ok: true };
      }

      if (type === 'admin') {
        if (!this.adminMenu) {
          throw new Error('Telegram-пульт Адміністратора не підключено');
        }
        const handled = await this.adminMenu.handle(
          action,
          id,
          chatId,
          actor,
          this.getWebAppUrl('admin'),
        );
        if (handled) return { ok: true };
      }

      if (type === 'booking' && action === 'approve') {
        await this.bookings.approve(id);
        await this.telegram.sendMessage(chatId, '✅ Бронювання підтверджено');
        return { ok: true };
      }

      if (type === 'booking' && action === 'reject') {
        await this.bookings.reject(id);
        await this.telegram.sendMessage(chatId, '❌ Бронювання відхилено');
        return { ok: true };
      }

      if (type === 'booking' && action === 'cancel') {
        await this.bookings.cancel(id);
        await this.telegram.sendMessage(chatId, '❌ Бронювання скасовано');
        return { ok: true };
      }

      if (type === 'booking' && action === 'checkin') {
        await this.bookings.checkIn(id, actor || undefined);
        await this.telegram.sendMessage(chatId, '⚫ Гості прийшли, стіл зайнятий');
        return { ok: true };
      }

      if (type === 'booking' && action === 'complete') {
        await this.bookings.complete(id, actor || undefined);
        await this.telegram.sendMessage(chatId, '🟢 Стіл вільний');
        return { ok: true };
      }

      if (type === 'reschedule' && action === 'approve') {
        await this.rescheduleApproval.approve(id);
        await this.telegram.sendMessage(chatId, '✅ Перенесення підтверджено');
        return { ok: true };
      }

      if (type === 'reschedule' && action === 'reject') {
        await this.bookings.rejectReschedule(id, {});
        await this.telegram.sendMessage(chatId, '❌ Перенесення відхилено');
        return { ok: true };
      }

      if (type === 'restaurant' && action === 'open') {
        if (actorRole === 'admin') await this.restaurant.adminOpenRestaurant();
        else await this.restaurant.openRestaurant();
        await this.telegram.sendMessage(chatId, '🟢 Ресторан відкрито');
        return { ok: true };
      }

      if (type === 'restaurant' && action === 'close_booking') {
        if (actorRole === 'admin') await this.restaurant.adminCloseBooking();
        else await this.restaurant.closeBooking();
        await this.telegram.sendMessage(chatId, '🔒 Онлайн-бронювання закрито');
        return { ok: true };
      }

      if (type === 'restaurant' && action === 'close_full') {
        if (actorRole === 'admin') await this.restaurant.adminCloseRestaurant({});
        else await this.restaurant.closeRestaurant({});
        await this.telegram.sendMessage(chatId, '🔴 Ресторан повністю закрито');
        return { ok: true };
      }

      await this.telegram.sendMessage(chatId, 'Команду не розпізнано');
      return { ok: true };
    } catch (error: any) {
      await this.telegram.sendMessage(
        chatId,
        `⚠️ Помилка: ${error?.message || 'невідома помилка'}`,
      );
      return { ok: false };
    }
  }

  private async getCallbackAuthorization(
    telegramUserId: string | number | undefined,
    type: string,
    action: string,
  ): Promise<CallbackAuthorization | null> {
    const rule = CALLBACK_ROLE_RULES[`${type}:${action}`];

    if (!rule) return { role: 'unprotected', actor: null };
    if (!telegramUserId) return null;

    const telegramId = String(telegramUserId);
    const actor = await this.telegramStaff.findActiveStaffByTelegramId(telegramId);

    if (!actor || !rule.roles.includes(actor.role)) return null;

    if (
      rule.requiresShift &&
      (actor.role === 'waiter' || actor.role === 'hookah') &&
      !actor.isOnShift
    ) {
      return null;
    }

    return {
      role: actor.role,
      actor: this.toAuthUser(actor, telegramId),
    };
  }

  private toAuthUser(staff: any, telegramId: string): AuthUser {
    return {
      sub: staff.id,
      telegramId,
      role: staff.role,
      staffId: staff.id,
      name: staff.fullName,
    };
  }

  private staffRoleMenu(role: StaffRole): {
    mode: 'waiter' | 'hookah' | 'admin' | 'director';
    title: string;
    button: string;
  } {
    if (role === 'owner') {
      return {
        mode: 'director',
        title: '📊 Панель директора',
        button: '📊 Відкрити панель директора',
      };
    }

    if (role === 'admin') {
      return {
        mode: 'admin',
        title: '👔 Панель адміністратора',
        button: '👔 Відкрити панель адміністратора',
      };
    }

    if (role === 'hookah') {
      return {
        mode: 'hookah',
        title: '💨 Панель кальянника',
        button: '💨 Відкрити панель кальянника',
      };
    }

    return {
      mode: 'waiter',
      title: '👨‍🍳 Панель офіціанта',
      button: '👨‍🍳 Відкрити панель офіціанта',
    };
  }

  private getWebAppUrl(
    mode: 'guest' | 'waiter' | 'hookah' | 'admin' | 'director',
  ) {
    const configuredUrl = process.env.TELEGRAM_WEB_APP_URL?.trim();
    if (!configuredUrl) return null;

    try {
      const url = new URL(configuredUrl);
      const isLocalhost =
        url.hostname === 'localhost' || url.hostname === '127.0.0.1';

      if (url.protocol !== 'https:' && !isLocalhost) return null;

      url.hash = mode;
      return url.toString();
    } catch {
      return null;
    }
  }
}
