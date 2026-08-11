import { Injectable } from '@nestjs/common';

import { BookingRescheduleApprovalService } from '../bookings/booking-reschedule-approval.service';
import { BookingsService } from '../bookings/bookings.service';
import { TelegramService } from '../notifications/telegram.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { TelegramStaffLinkService } from '../staff/telegram-staff-link.service';
import type { StaffRole } from '../staff/entities/staff.entity';

@Injectable()
export class TelegramWebhookService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly restaurant: RestaurantService,
    private readonly telegram: TelegramService,
    private readonly telegramStaff: TelegramStaffLinkService,
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

    if (text === '/start' || text.startsWith('/start ')) {
      const telegramId = String(message.from?.id || '');
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

      const roleMenu = this.staffRoleMenu(staff.role);
      const appUrl = this.getWebAppUrl(roleMenu.mode);
      const keyboard = appUrl
        ? {
            inline_keyboard: [
              [
                {
                  text: roleMenu.button,
                  web_app: { url: appUrl },
                },
              ],
            ],
          }
        : undefined;

      await this.telegram.sendMessage(
        chatId,
        `Вітаємо, ${staff.fullName} 👋\n\n${roleMenu.title}`,
        keyboard,
      );
      return { ok: true };
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
      if (type === 'menu' && action === 'admin') {
        const keyboard: Array<Array<Record<string, unknown>>> = [];
        const adminAppUrl = this.getWebAppUrl('admin');

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
        await this.bookings.checkIn(id);
        await this.telegram.sendMessage(chatId, '⚫ Гості прийшли, стіл зайнятий');
        return { ok: true };
      }

      if (type === 'booking' && action === 'complete') {
        await this.bookings.complete(id);
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
        await this.restaurant.openRestaurant();
        await this.telegram.sendMessage(chatId, '🟢 Ресторан відкрито');
        return { ok: true };
      }

      if (type === 'restaurant' && action === 'close_booking') {
        await this.restaurant.closeBooking();
        await this.telegram.sendMessage(chatId, '🔒 Онлайн-бронювання закрито');
        return { ok: true };
      }

      if (type === 'restaurant' && action === 'close_full') {
        await this.restaurant.closeRestaurant({});
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
