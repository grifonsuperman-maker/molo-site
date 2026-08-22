import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import type { AuthUser } from '../auth/types/auth-user.type';
import { AdminAttentionService } from '../bookings/admin-attention.service';
import { BookingRescheduleApprovalService } from '../bookings/booking-reschedule-approval.service';
import { BookingsService } from '../bookings/bookings.service';
import { BroadcastsService } from '../broadcasts/broadcasts.service';
import { TelegramService } from '../notifications/telegram.service';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { TablesService } from '../tables/tables.service';

const PAGE_SIZE = 8;
const REVIEWS_PAGE_SIZE = 4;
const REVIEW_TEXT_LIMIT = 350;
const BROADCAST_DRAFT_TTL_MS = 10 * 60 * 1000;

const LOCATIONS = [
  { key: 'hall', label: 'Зал ресторану', accepts: (value: number) => value >= 1 && value <= 14 },
  { key: 'canopy', label: 'Навіс', accepts: (value: number) => value >= 15 && value <= 20 },
  { key: 'gazebo', label: 'Велика альтанка', accepts: (value: number) => value >= 21 && value <= 36 },
  { key: 'rotang', label: 'Ротанг', accepts: (value: number) => value >= 37 && value <= 39 },
  { key: 'embankment', label: 'Набережна', accepts: (value: number) => value >= 40 && value <= 44 },
  { key: 'glass_gazebo', label: 'Скляна альтанка', accepts: (value: number) => value >= 45 && value <= 50 },
  { key: 'water_gazebo', label: 'Альтанка на воді', accepts: (value: number) => value >= 100 && value <= 109 },
] as const;

type BroadcastDraft = {
  stage: 'awaiting_text' | 'confirm';
  id?: string;
  message?: string;
  recipientCount: number;
  expiresAt: number;
};

@Injectable()
export class TelegramAdminMenuService {
  private readonly broadcastDrafts = new Map<string, BroadcastDraft>();

  constructor(
    private readonly bookings: BookingsService,
    private readonly rescheduleApproval: BookingRescheduleApprovalService,
    private readonly attention: AdminAttentionService,
    private readonly broadcasts: BroadcastsService,
    private readonly permissions: AdminPermissionsService,
    private readonly restaurant: RestaurantService,
    private readonly tables: TablesService,
    private readonly telegram: TelegramService,
  ) {}

  hasPendingInput(telegramId: string) {
    const key = String(telegramId || '').trim();
    if (!key) return false;
    const draft = this.broadcastDrafts.get(key);
    if (!draft) return false;
    if (draft.expiresAt <= Date.now()) {
      this.broadcastDrafts.delete(key);
      return false;
    }
    return true;
  }

  clearPendingInput(telegramId: string) {
    const key = String(telegramId || '').trim();
    if (key) this.broadcastDrafts.delete(key);
  }

  async sendMenu(
    chatId: string | number,
    actor: AuthUser,
    adminAppUrl?: string | null,
  ) {
    this.assertAdminActor(actor);
    const [today, reschedules, dashboard, restaurant] = await Promise.all([
      this.bookings.getToday(),
      this.bookings.getPendingReschedules(),
      this.attention.dashboard(),
      this.restaurant.getRestaurant(),
    ]);

    const pendingCount = today.filter((booking) => booking.status === 'pending').length;
    const canBroadcast =
      actor.role === 'owner' || Boolean(restaurant.adminCanSendBroadcasts);
    const keyboard: Array<Array<Record<string, unknown>>> = [
      [
        {
          text: `📋 Бронювання сьогодні · ${today.length}`,
          callback_data: 'admin:bookings:0',
        },
      ],
      [
        {
          text: `🔁 Перенесення · ${reschedules.length}`,
          callback_data: 'admin:reschedules:0',
        },
        {
          text: `⚠️ Запити гостей · ${dashboard.tableChanges.length}`,
          callback_data: 'admin:attention:0',
        },
      ],
      [
        {
          text: `💬 Відгуки · ${dashboard.reviews.length}`,
          callback_data: 'admin:reviews:0',
        },
        {
          text: '🪑 Локації та столи',
          callback_data: 'admin:locations',
        },
      ],
    ];

    if (canBroadcast) {
      keyboard.push([
        {
          text: '📣 Розсилка всім гостям',
          callback_data: 'admin:broadcast',
        },
      ]);
    }

    keyboard.push([
      {
        text: `🏪 Ресторан · ${this.restaurantStatusLabel(restaurant.status)}`,
        callback_data: 'admin:restaurant',
      },
    ]);

    if (adminAppUrl) {
      keyboard.push([
        {
          text: '📱 Відкрити повний пульт',
          web_app: { url: adminAppUrl },
        },
      ]);
    }

    await this.telegram.sendMessage(
      chatId,
      [
        '👔 <b>Пульт Адміністратора</b>',
        '',
        `📅 Бронювань сьогодні: <b>${today.length}</b>`,
        `⏳ Очікують підтвердження: <b>${pendingCount}</b>`,
        `🔁 Запитів на перенесення: <b>${reschedules.length}</b>`,
        `⚠️ Запитів на інший стіл: <b>${dashboard.tableChanges.length}</b>`,
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
    adminAppUrl?: string | null,
  ) {
    this.assertAdminActor(actor);

    if (action === 'bookings') {
      await this.sendBookings(chatId, this.parsePage(id));
      return true;
    }
    if (action === 'booking') {
      await this.sendBooking(chatId, id);
      return true;
    }
    if (action.startsWith('booking_')) {
      await this.runBookingAction(chatId, id, action, actor);
      return true;
    }
    if (action === 'reschedules') {
      await this.sendReschedules(chatId, this.parsePage(id));
      return true;
    }
    if (action === 'reschedule') {
      await this.sendReschedule(chatId, id);
      return true;
    }
    if (action.startsWith('reschedule_')) {
      await this.runRescheduleAction(chatId, id, action);
      return true;
    }
    if (action === 'attention') {
      await this.sendAttention(chatId, this.parsePage(id), adminAppUrl);
      return true;
    }
    if (action === 'attention_item') {
      await this.sendAttentionItem(chatId, id, adminAppUrl);
      return true;
    }
    if (action === 'reviews') {
      await this.sendReviews(chatId, this.parsePage(id));
      return true;
    }
    if (action === 'locations') {
      await this.sendLocations(chatId);
      return true;
    }
    if (action === 'location') {
      await this.sendLocation(chatId, id);
      return true;
    }
    if (action === 'table') {
      await this.sendTable(chatId, id);
      return true;
    }
    if (action === 'broadcast') {
      await this.beginBroadcast(chatId, actor);
      return true;
    }
    if (action === 'broadcast_confirm') {
      await this.confirmBroadcast(chatId, actor, id, adminAppUrl);
      return true;
    }
    if (action === 'broadcast_cancel') {
      await this.cancelBroadcast(chatId, actor, id, adminAppUrl);
      return true;
    }
    if (action === 'restaurant') {
      await this.sendRestaurant(chatId, actor);
      return true;
    }
    if (action === 'restaurant_open') {
      if (actor.role === 'admin') await this.restaurant.adminOpenRestaurant();
      else await this.restaurant.openRestaurant();
      await this.sendRestaurant(chatId, actor, '🟢 Ресторан відкрито');
      return true;
    }
    if (action === 'booking_open') {
      if (actor.role === 'admin') await this.restaurant.adminOpenBooking();
      else await this.restaurant.openBooking();
      await this.sendRestaurant(chatId, actor, '🟢 Онлайн-бронювання відкрито');
      return true;
    }
    if (action === 'booking_close') {
      if (actor.role === 'admin') await this.restaurant.adminCloseBooking();
      else await this.restaurant.closeBooking();
      await this.sendRestaurant(chatId, actor, '🔒 Онлайн-бронювання закрито');
      return true;
    }
    if (action === 'restaurant_close') {
      if (actor.role === 'admin') await this.restaurant.adminCloseRestaurant({});
      else await this.restaurant.closeRestaurant({});
      await this.sendRestaurant(chatId, actor, '🔴 Ресторан закрито');
      return true;
    }

    return false;
  }

  async handleText(text: string, chatId: string | number, actor: AuthUser) {
    this.assertAdminActor(actor);
    const key = this.actorKey(actor);
    const draft = this.broadcastDrafts.get(key);
    if (!draft || draft.expiresAt <= Date.now()) {
      this.broadcastDrafts.delete(key);
      return false;
    }

    if (String(text || '').trim() === '/cancel') {
      this.broadcastDrafts.delete(key);
      await this.telegram.sendMessage(chatId, '❌ Розсилку скасовано');
      return true;
    }

    await this.permissions.assert(actor, 'adminCanSendBroadcasts');
    const message = String(text || '').trim();
    if (!message) {
      await this.telegram.sendMessage(chatId, '⚠️ Введіть текст повідомлення');
      return true;
    }
    if (message.length > 3500) {
      await this.telegram.sendMessage(
        chatId,
        '⚠️ Повідомлення занадто довге. Максимум 3500 символів.',
      );
      return true;
    }

    const draftId = randomBytes(8).toString('hex');
    this.broadcastDrafts.set(key, {
      stage: 'confirm',
      id: draftId,
      message,
      recipientCount: draft.recipientCount,
      expiresAt: Date.now() + BROADCAST_DRAFT_TTL_MS,
    });

    await this.telegram.sendMessage(
      chatId,
      [
        '📣 <b>Перевірте розсилку</b>',
        '',
        `Отримувачів у базі: <b>${draft.recipientCount}</b>`,
        'Повідомлення отримають гості з доступним Telegram.',
        '',
        `<blockquote>${this.escapeHtml(message)}</blockquote>`,
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '✅ Надіслати всім',
              callback_data: `admin:broadcast_confirm:${draftId}`,
            },
          ],
          [
            {
              text: '❌ Скасувати',
              callback_data: `admin:broadcast_cancel:${draftId}`,
            },
          ],
        ],
      },
    );
    return true;
  }

  private async sendBookings(
    chatId: string | number,
    requestedPage: number,
    notice?: string,
  ) {
    const bookings = await this.bookings.getToday();
    const page = this.paginate(bookings, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (booking: any) => [
        {
          text: `${this.bookingStatusEmoji(booking.status)} ${this.timeLabel(booking.bookingTime)} · №${booking.table?.tableNumber || '—'} · ${booking.client?.fullName || 'Гість'}`.slice(0, 60),
          callback_data: `admin:booking:${booking.id}`,
        },
      ],
    );
    this.addPageButtons(keyboard, 'admin:bookings', page.pageIndex, page.totalPages);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:admin' }]);
    const title = bookings.length
      ? `📋 <b>Бронювання сьогодні</b> · ${bookings.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
      : '📋 <b>Бронювання сьогодні</b>\n\nБронювань немає.';
    await this.telegram.sendMessage(
      chatId,
      notice ? `${notice}\n\n${title}` : title,
      { inline_keyboard: keyboard },
    );
  }

  private async sendBooking(chatId: string | number, id: string | undefined) {
    if (!id) throw new BadRequestException('Бронювання не вказано');
    const bookings = await this.bookings.getToday();
    const booking: any = bookings.find((item: any) => item.id === id);
    if (!booking) {
      await this.sendBookings(chatId, 0);
      return;
    }

    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (booking.status === 'pending') {
      keyboard.push([
        {
          text: '✅ Підтвердити',
          callback_data: `admin:booking_approve:${booking.id}`,
        },
        {
          text: '❌ Відхилити',
          callback_data: `admin:booking_reject:${booking.id}`,
        },
      ]);
    }
    if (booking.status === 'approved' && !booking.checkedInAt) {
      keyboard.push([
        {
          text: '⚫ Гості прийшли',
          callback_data: `admin:booking_checkin:${booking.id}`,
        },
      ]);
    }
    if (booking.status === 'approved' && booking.checkedInAt) {
      keyboard.push([
        {
          text: '✅ Завершити візит',
          callback_data: `admin:booking_complete:${booking.id}`,
        },
      ]);
    }
    keyboard.push([{ text: '⬅️ До бронювань', callback_data: 'admin:bookings:0' }]);

    await this.telegram.sendMessage(
      chatId,
      [
        '📋 <b>Бронювання</b>',
        `Статус: <b>${this.bookingStatusLabel(booking.status)}</b>`,
        `📅 ${this.dateLabel(booking.bookingDate)} · 🕒 ${this.timeLabel(booking.bookingTime)}`,
        `🪑 Стіл №<b>${this.escapeHtml(String(booking.table?.tableNumber || '—'))}</b>`,
        `📍 ${this.escapeHtml(booking.table?.zone?.name || 'Локація не вказана')}`,
        `👤 ${this.escapeHtml(booking.client?.fullName || 'Гість')}`,
        `📞 ${this.escapeHtml(booking.client?.phone || '—')}`,
        `👥 Гостей: <b>${booking.guestsCount || '—'}</b>`,
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async runBookingAction(
    chatId: string | number,
    id: string | undefined,
    action: string,
    actor: AuthUser,
  ) {
    if (!id) throw new BadRequestException('Бронювання не вказано');
    if (action === 'booking_approve') await this.bookings.approve(id);
    else if (action === 'booking_reject') await this.bookings.reject(id);
    else if (action === 'booking_checkin') await this.bookings.checkIn(id, actor);
    else if (action === 'booking_complete') await this.bookings.complete(id, actor);
    else return;

    const notice = ({
      booking_approve: '✅ Бронювання підтверджено',
      booking_reject: '❌ Бронювання відхилено',
      booking_checkin: '⚫ Гості відмічені як прибулі',
      booking_complete: '✅ Візит завершено',
    } as Record<string, string>)[action];
    await this.sendBookings(chatId, 0, notice);
  }

  private async sendReschedules(
    chatId: string | number,
    requestedPage: number,
    notice?: string,
  ) {
    const requests: any[] = await this.bookings.getPendingReschedules();
    const page = this.paginate(requests, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (request: any) => [
        {
          text: `🔁 №${request.booking?.table?.tableNumber || '—'} · ${this.dateLabel(request.requestedDate)} ${this.timeLabel(request.requestedTime)}`.slice(0, 60),
          callback_data: `admin:reschedule:${request.id}`,
        },
      ],
    );
    this.addPageButtons(keyboard, 'admin:reschedules', page.pageIndex, page.totalPages);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:admin' }]);
    const title = requests.length
      ? `🔁 <b>Запити на перенесення</b> · ${requests.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
      : '🔁 <b>Запити на перенесення</b>\n\nНових запитів немає.';
    await this.telegram.sendMessage(
      chatId,
      notice ? `${notice}\n\n${title}` : title,
      { inline_keyboard: keyboard },
    );
  }

  private async sendReschedule(chatId: string | number, id: string | undefined) {
    if (!id) throw new BadRequestException('Запит не вказано');
    const requests: any[] = await this.bookings.getPendingReschedules();
    const request = requests.find((item) => item.id === id);
    if (!request) {
      await this.sendReschedules(chatId, 0);
      return;
    }

    await this.telegram.sendMessage(
      chatId,
      [
        '🔁 <b>Перенесення бронювання</b>',
        `👤 ${this.escapeHtml(request.booking?.client?.fullName || 'Гість')}`,
        `🪑 Стіл №${this.escapeHtml(String(request.booking?.table?.tableNumber || '—'))}`,
        `Було: <b>${this.dateLabel(request.booking?.bookingDate)} · ${this.timeLabel(request.booking?.bookingTime)}</b>`,
        `Просить: <b>${this.dateLabel(request.requestedDate)} · ${this.timeLabel(request.requestedTime)}</b>`,
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '✅ Підтвердити перенесення',
              callback_data: `admin:reschedule_approve:${request.id}`,
            },
          ],
          [
            {
              text: '❌ Відхилити',
              callback_data: `admin:reschedule_reject:${request.id}`,
            },
          ],
          [{ text: '⬅️ Назад', callback_data: 'admin:reschedules:0' }],
        ],
      },
    );
  }

  private async runRescheduleAction(
    chatId: string | number,
    id: string | undefined,
    action: string,
  ) {
    if (!id) throw new BadRequestException('Запит не вказано');
    if (action === 'reschedule_approve') {
      await this.rescheduleApproval.approve(id);
      await this.sendReschedules(chatId, 0, '✅ Перенесення підтверджено');
      return;
    }
    if (action === 'reschedule_reject') {
      await this.bookings.rejectReschedule(id, {});
      await this.sendReschedules(chatId, 0, '❌ Перенесення відхилено');
    }
  }

  private async sendAttention(
    chatId: string | number,
    requestedPage: number,
    adminAppUrl?: string | null,
  ) {
    const dashboard: any = await this.attention.dashboard();
    const requests: any[] = dashboard.tableChanges || [];
    const page = this.paginate(requests, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (request: any) => [
        {
          text: `⚠️ №${request.booking?.table?.tableNumber || '—'} → ${request.requestedTableNumber ? `№${request.requestedTableNumber}` : 'підібрати'}`.slice(0, 60),
          callback_data: `admin:attention_item:${request.id}`,
        },
      ],
    );
    this.addPageButtons(keyboard, 'admin:attention', page.pageIndex, page.totalPages);
    if (adminAppUrl) {
      keyboard.push([
        {
          text: '📱 Опрацювати у повному пульті',
          web_app: { url: adminAppUrl },
        },
      ]);
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:admin' }]);

    await this.telegram.sendMessage(
      chatId,
      requests.length
        ? `⚠️ <b>Запити гостей на інший стіл</b> · ${requests.length}\nДля безпечного вибору нового столу використовуйте повний пульт.`
        : '⚠️ <b>Запити гостей</b>\n\nНових запитів на інший стіл немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendAttentionItem(
    chatId: string | number,
    id: string | undefined,
    adminAppUrl?: string | null,
  ) {
    if (!id) throw new BadRequestException('Запит не вказано');
    const dashboard: any = await this.attention.dashboard();
    const request = (dashboard.tableChanges || []).find((item: any) => item.id === id);
    if (!request) {
      await this.sendAttention(chatId, 0, adminAppUrl);
      return;
    }

    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (adminAppUrl) {
      keyboard.push([
        {
          text: '📱 Підібрати стіл у повному пульті',
          web_app: { url: adminAppUrl },
        },
      ]);
    }
    keyboard.push([{ text: '⬅️ До запитів', callback_data: 'admin:attention:0' }]);

    await this.telegram.sendMessage(
      chatId,
      [
        '⚠️ <b>Гість просить інший стіл</b>',
        `👤 ${this.escapeHtml(request.booking?.client?.fullName || 'Гість')}`,
        `📅 ${this.dateLabel(request.booking?.bookingDate)} · ${this.timeLabel(request.booking?.bookingTime)}`,
        `🪑 Поточний: №${this.escapeHtml(String(request.booking?.table?.tableNumber || '—'))}`,
        `🎯 Бажаний: ${request.requestedTableNumber ? `№${this.escapeHtml(String(request.requestedTableNumber))}` : 'підібрати Адміністратору'}`,
        '',
        'Поточний стіл залишається за гостем до підтвердження в повному пульті.',
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async sendReviews(chatId: string | number, requestedPage: number) {
    const dashboard: any = await this.attention.dashboard();
    const reviews: any[] = dashboard.reviews || [];
    const page = this.paginate(reviews, requestedPage, REVIEWS_PAGE_SIZE);
    const lines = page.items.map(
      (review: any) =>
        `• <b>${this.escapeHtml(review.booking?.client?.fullName || 'Гість')}</b> · №${this.escapeHtml(String(review.booking?.table?.tableNumber || '—'))}\n${this.escapeHtml(String(review.text || 'Без тексту').slice(0, REVIEW_TEXT_LIMIT))}`,
    );
    const keyboard: Array<Array<Record<string, unknown>>> = [];
    this.addPageButtons(keyboard, 'admin:reviews', page.pageIndex, page.totalPages);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:admin' }]);
    await this.telegram.sendMessage(
      chatId,
      reviews.length
        ? `💬 <b>Відгуки гостей</b> · ${reviews.length}\n\n${lines.join('\n\n')}\n\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '💬 <b>Відгуки гостей</b>\n\nВідгуків поки немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendLocations(chatId: string | number) {
    const tables: any[] = (await this.tables.findAll()).filter(
      (table: any) => table.isVisible !== false,
    );
    const keyboard: Array<Array<Record<string, unknown>>> = LOCATIONS.map(
      (location) => [
        {
          text: `📍 ${location.label} · ${tables.filter((table) => location.accepts(Number(table.tableNumber))).length}`,
          callback_data: `admin:location:${location.key}`,
        },
      ],
    );
    const otherCount = tables.filter(
      (table) => !LOCATIONS.some((location) => location.accepts(Number(table.tableNumber))),
    ).length;
    if (otherCount) {
      keyboard.push([
        {
          text: `📍 Без визначеної локації · ${otherCount}`,
          callback_data: 'admin:location:other',
        },
      ]);
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:admin' }]);

    await this.telegram.sendMessage(
      chatId,
      '🪑 <b>Локації та столи</b>\n\nПоказано поточний фізичний статус. Зміна статусу столу залишається у повному пульті.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendLocation(chatId: string | number, key: string | undefined) {
    const tables: any[] = (await this.tables.findAll())
      .filter((table: any) => table.isVisible !== false)
      .filter((table: any) => this.locationKeyForTable(table) === key)
      .sort((left: any, right: any) => Number(left.tableNumber) - Number(right.tableNumber));
    const keyboard: Array<Array<Record<string, unknown>>> = tables.map((table: any) => [
      {
        text: `${this.tableStatusEmoji(table.status)} №${table.tableNumber} · ${this.tableStatusLabel(table.status)}`.slice(0, 60),
        callback_data: `admin:table:${table.id}`,
      },
    ]);
    keyboard.push([{ text: '⬅️ До локацій', callback_data: 'admin:locations' }]);
    await this.telegram.sendMessage(
      chatId,
      `📍 <b>${this.escapeHtml(this.locationLabelForKey(key || 'other'))}</b>\nСтолів: <b>${tables.length}</b>`,
      { inline_keyboard: keyboard },
    );
  }

  private async sendTable(chatId: string | number, id: string | undefined) {
    if (!id) throw new BadRequestException('Стіл не вказано');
    const tables: any[] = await this.tables.findAll();
    const table = tables.find((item: any) => item.id === id);
    if (!table) throw new BadRequestException('Стіл не знайдено');
    const locationKey = this.locationKeyForTable(table);
    await this.telegram.sendMessage(
      chatId,
      [
        '🪑 <b>Стіл</b>',
        `№<b>${this.escapeHtml(String(table.tableNumber))}</b>`,
        `📍 ${this.escapeHtml(table.zone?.name || this.locationLabelForKey(locationKey))}`,
        `👥 Місць: <b>${table.seats || '—'}</b>`,
        `${this.tableStatusEmoji(table.status)} Статус: <b>${this.tableStatusLabel(table.status)}</b>`,
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '⬅️ До локації',
              callback_data: `admin:location:${locationKey}`,
            },
          ],
        ],
      },
    );
  }

  private async beginBroadcast(chatId: string | number, actor: AuthUser) {
    await this.permissions.assert(actor, 'adminCanSendBroadcasts');
    const recipients = await this.broadcasts.getTargetClients('all_clients');
    if (!recipients.length) {
      throw new BadRequestException('Немає доступних гостей для розсилки');
    }
    const draftId = randomBytes(8).toString('hex');
    this.broadcastDrafts.set(this.actorKey(actor), {
      stage: 'awaiting_text',
      id: draftId,
      recipientCount: recipients.length,
      expiresAt: Date.now() + BROADCAST_DRAFT_TTL_MS,
    });
    await this.telegram.sendMessage(
      chatId,
      [
        '📣 <b>Розсилка всім гостям</b>',
        '',
        `У базі доступно гостей: <b>${recipients.length}</b>.`,
        'Надішліть наступним повідомленням текст розсилки.',
        'Після цього бот покаже попередній перегляд і попросить підтвердження.',
        '',
        'Для скасування надішліть /cancel.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '❌ Скасувати',
              callback_data: `admin:broadcast_cancel:${draftId}`,
            },
          ],
        ],
      },
    );
  }

  private async confirmBroadcast(
    chatId: string | number,
    actor: AuthUser,
    draftId: string | undefined,
    adminAppUrl?: string | null,
  ) {
    await this.permissions.assert(actor, 'adminCanSendBroadcasts');
    const key = this.actorKey(actor);
    const draft = this.broadcastDrafts.get(key);
    if (
      !draft ||
      draft.stage !== 'confirm' ||
      !draft.id ||
      draft.id !== draftId ||
      !draft.message ||
      draft.expiresAt <= Date.now()
    ) {
      throw new BadRequestException(
        'Ця кнопка підтвердження вже неактуальна. Перевірте останню версію розсилки.',
      );
    }

    this.broadcastDrafts.delete(key);
    const result = await this.broadcasts.sendNow({
      message: draft.message,
      target: 'all_clients',
    } as any);

    await this.telegram.sendMessage(
      chatId,
      [
        '✅ <b>Розсилку оброблено</b>',
        `Отримувачів: <b>${result.recipientCount}</b>`,
        `Доставлено: <b>${result.deliveredCount}</b>`,
        `Без доступного Telegram / не доставлено: <b>${result.unreachableCount}</b>`,
      ].join('\n'),
    );
    await this.sendMenu(chatId, actor, adminAppUrl);
  }

  private async cancelBroadcast(
    chatId: string | number,
    actor: AuthUser,
    draftId: string | undefined,
    adminAppUrl?: string | null,
  ) {
    const key = this.actorKey(actor);
    const draft = this.broadcastDrafts.get(key);
    if (
      !draft ||
      !draft.id ||
      draft.id !== draftId ||
      draft.expiresAt <= Date.now()
    ) {
      throw new BadRequestException(
        'Ця кнопка скасування вже неактуальна. Відкрийте останню версію розсилки.',
      );
    }
    this.broadcastDrafts.delete(key);
    await this.sendMenu(chatId, actor, adminAppUrl);
  }

  private async sendRestaurant(
    chatId: string | number,
    actor: AuthUser,
    notice?: string,
  ) {
    const restaurant: any = await this.restaurant.getRestaurant();
    const canManageOnline =
      actor.role === 'owner' || Boolean(restaurant.adminCanManageOnlineBooking);
    const canManageRestaurant =
      actor.role === 'owner' || Boolean(restaurant.adminCanManageRestaurant);
    const keyboard: Array<Array<Record<string, unknown>>> = [];

    if (restaurant.status === 'closed') {
      if (canManageRestaurant) {
        keyboard.push([
          {
            text: '🟢 Відкрити ресторан',
            callback_data: 'admin:restaurant_open',
          },
        ]);
      }
    } else {
      if (canManageOnline) {
        keyboard.push([
          restaurant.status === 'booking_closed'
            ? {
                text: '🟢 Відкрити онлайн-бронювання',
                callback_data: 'admin:booking_open',
              }
            : {
                text: '🔒 Закрити онлайн-бронювання',
                callback_data: 'admin:booking_close',
              },
        ]);
      }
      if (canManageRestaurant) {
        keyboard.push([
          {
            text: '🔴 Закрити ресторан',
            callback_data: 'admin:restaurant_close',
          },
        ]);
      }
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:admin' }]);

    await this.telegram.sendMessage(
      chatId,
      [
        notice || '🏪 <b>Стан ресторану</b>',
        '',
        `Статус: <b>${this.restaurantStatusLabel(restaurant.status)}</b>`,
        canManageOnline
          ? '✅ Є право керувати онлайн-бронюванням'
          : '🔒 Немає права керувати онлайн-бронюванням',
        canManageRestaurant
          ? '✅ Є право відкривати/закривати ресторан'
          : '🔒 Немає права відкривати/закривати ресторан',
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private addPageButtons(
    keyboard: Array<Array<Record<string, unknown>>>,
    prefix: string,
    pageIndex: number,
    totalPages: number,
  ) {
    const row: Array<Record<string, unknown>> = [];
    if (pageIndex > 0) {
      row.push({ text: '⬅️', callback_data: `${prefix}:${pageIndex - 1}` });
    }
    if (pageIndex + 1 < totalPages) {
      row.push({ text: '➡️', callback_data: `${prefix}:${pageIndex + 1}` });
    }
    if (row.length) keyboard.push(row);
  }

  private paginate<T>(
    items: T[],
    requestedPage: number,
    pageSize = PAGE_SIZE,
  ) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const pageIndex = Math.min(Math.max(0, requestedPage), totalPages - 1);
    const start = pageIndex * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      pageIndex,
      totalPages,
    };
  }

  private parsePage(value: string | undefined) {
    const page = Number(value);
    return Number.isInteger(page) && page >= 0 ? page : 0;
  }

  private actorKey(actor: AuthUser) {
    return String(actor.telegramId || actor.staffId || actor.sub || '');
  }

  private assertAdminActor(actor: AuthUser | null): asserts actor is AuthUser {
    if (!actor || (actor.role !== 'admin' && actor.role !== 'owner')) {
      throw new BadRequestException('Команда доступна лише Адміністратору або Директору');
    }
  }

  private locationKeyForTable(table: any) {
    const value = Number(table?.tableNumber || 0);
    return LOCATIONS.find((location) => location.accepts(value))?.key || 'other';
  }

  private locationLabelForKey(key: string) {
    return LOCATIONS.find((location) => location.key === key)?.label || 'Без визначеної локації';
  }

  private tableStatusLabel(status: string) {
    return ({
      free: 'Вільний',
      pending: 'Очікує',
      reserved: 'Заброньований',
      occupied: 'Зайнятий',
      cleaning: 'Готується',
      closed: 'Недоступний',
    } as Record<string, string>)[status] || status || 'Невідомо';
  }

  private tableStatusEmoji(status: string) {
    return ({
      free: '🟢',
      pending: '🔵',
      reserved: '🟠',
      occupied: '🔴',
      cleaning: '🧼',
      closed: '⚪',
    } as Record<string, string>)[status] || '⚪';
  }

  private bookingStatusLabel(status: string) {
    return ({
      pending: 'Очікує підтвердження',
      approved: 'Підтверджено',
      rejected: 'Відхилено',
      cancelled: 'Скасовано',
      completed: 'Завершено',
    } as Record<string, string>)[status] || status || 'Невідомо';
  }

  private bookingStatusEmoji(status: string) {
    return ({
      pending: '⏳',
      approved: '✅',
      rejected: '❌',
      cancelled: '🚫',
      completed: '🏁',
    } as Record<string, string>)[status] || '📋';
  }

  private restaurantStatusLabel(status: string) {
    return ({
      open: 'Відкрито',
      booking_closed: 'Бронювання закрито',
      closed: 'Закрито',
    } as Record<string, string>)[status] || status || 'Невідомо';
  }

  private timeLabel(value: string | null | undefined) {
    const [hours = '00', minutes = '00'] = String(value || '').split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }

  private dateLabel(value: string | null | undefined) {
    const [year, month, day] = String(value || '').split('-');
    return year && month && day ? `${day}.${month}.${year}` : String(value || '—');
  }

  private escapeHtml(value: string) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
