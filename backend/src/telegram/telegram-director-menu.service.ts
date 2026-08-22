import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import type { AuthUser } from '../auth/types/auth-user.type';
import { AnalyticsService } from '../analytics/analytics.service';
import { BookingsService } from '../bookings/bookings.service';
import { BroadcastsService } from '../broadcasts/broadcasts.service';
import { LogsService } from '../logs/logs.service';
import { TelegramService } from '../notifications/telegram.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { StaffService } from '../staff/staff.service';
import { TablesService } from '../tables/tables.service';

const PAGE_SIZE = 8;
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

const ADMIN_RIGHTS = [
  { key: 'zones', field: 'adminCanManageZones', label: 'Локації та зони' },
  { key: 'online_booking', field: 'adminCanManageOnlineBooking', label: 'Онлайн-бронювання' },
  { key: 'restaurant', field: 'adminCanManageRestaurant', label: 'Відкрити / закрити ресторан' },
  { key: 'site_mode', field: 'adminCanChangeSiteMode', label: 'Режим сайту' },
  { key: 'settings', field: 'adminCanEditRestaurantSettings', label: 'Налаштування ресторану' },
  { key: 'blacklist', field: 'adminCanManageBlacklist', label: 'Чорний список' },
  { key: 'reviews', field: 'adminCanRespondReviews', label: 'Відповіді на відгуки' },
  { key: 'shifts', field: 'adminCanManageStaffShifts', label: 'Зміни персоналу' },
  { key: 'broadcasts', field: 'adminCanSendBroadcasts', label: 'Розсилки гостям' },
] as const;

type BroadcastDraft = {
  stage: 'awaiting_text' | 'confirm';
  id: string;
  message?: string;
  recipientCount: number;
  expiresAt: number;
};

@Injectable()
export class TelegramDirectorMenuService {
  private readonly broadcastDrafts = new Map<string, BroadcastDraft>();

  constructor(
    private readonly bookings: BookingsService,
    private readonly broadcasts: BroadcastsService,
    private readonly restaurant: RestaurantService,
    private readonly tables: TablesService,
    private readonly staff: StaffService,
    private readonly analytics: AnalyticsService,
    private readonly logs: LogsService,
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
    directorAppUrl?: string | null,
  ) {
    this.assertDirector(actor);
    const [today, reschedules, restaurant, stats, staff] = await Promise.all([
      this.bookings.getToday(),
      this.bookings.getPendingReschedules(),
      this.restaurant.getRestaurant(),
      this.analytics.getToday(),
      this.staff.findAll(),
    ]);
    const pending = today.filter((booking: any) => booking.status === 'pending').length;
    const activeStaff = staff.filter((member: any) => member.active && !member.isArchived);
    const onShift = activeStaff.filter((member: any) => member.isOnShift).length;
    const keyboard: Array<Array<Record<string, unknown>>> = [
      [
        { text: `📋 Бронювання · ${today.length}`, callback_data: 'director:bookings:0' },
        { text: `🔁 Перенесення · ${reschedules.length}`, callback_data: 'director:reschedules:0' },
      ],
      [
        { text: '🪑 Локації та столи', callback_data: 'director:locations' },
        { text: `👥 Команда · ${onShift}/${activeStaff.length}`, callback_data: 'director:team:0' },
      ],
      [
        { text: '📈 Статистика', callback_data: 'director:stats' },
        { text: '📜 Дії персоналу', callback_data: 'director:activity' },
      ],
      [{ text: '📣 Розсилка всім гостям', callback_data: 'director:broadcast' }],
      [{ text: '👔 Права Адміністратора', callback_data: 'director:admin_rights' }],
      [
        {
          text: `🏪 Ресторан · ${this.restaurantStatusLabel(restaurant.status)}`,
          callback_data: 'director:restaurant',
        },
      ],
    ];
    if (directorAppUrl) {
      keyboard.push([
        { text: '📱 Відкрити повний пульт', web_app: { url: directorAppUrl } },
      ]);
    }
    await this.telegram.sendMessage(
      chatId,
      [
        '📊 <b>Пульт Директора</b>',
        '',
        `📅 Бронювань сьогодні: <b>${today.length}</b>`,
        `⏳ Очікують рішення: <b>${pending}</b>`,
        `👥 Гостей сьогодні: <b>${stats.guestsCount || 0}</b>`,
        `🔴 Зайнятих столів: <b>${stats.occupiedTables || 0}</b>`,
        `👤 Працівників на зміні: <b>${onShift}</b>`,
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
    directorAppUrl?: string | null,
  ) {
    this.assertDirector(actor);
    if (action === 'bookings') {
      await this.sendBookings(chatId, this.parsePage(id), directorAppUrl);
      return true;
    }
    if (action === 'booking') {
      await this.sendBooking(chatId, id, directorAppUrl);
      return true;
    }
    if (action === 'reschedules') {
      await this.sendReschedules(chatId, this.parsePage(id), directorAppUrl);
      return true;
    }
    if (action === 'reschedule') {
      await this.sendReschedule(chatId, id, directorAppUrl);
      return true;
    }
    if (action === 'locations') {
      await this.sendLocations(chatId);
      return true;
    }
    if (action === 'location') {
      await this.sendLocation(chatId, id, 0);
      return true;
    }
    if (action === 'location_page') {
      const [key, page] = String(id || '').split(',');
      await this.sendLocation(chatId, key, this.parsePage(page));
      return true;
    }
    if (action === 'table') {
      await this.sendTable(chatId, id);
      return true;
    }
    if (action === 'team') {
      await this.sendTeam(chatId, this.parsePage(id));
      return true;
    }
    if (action === 'stats') {
      await this.sendStats(chatId);
      return true;
    }
    if (action === 'activity') {
      await this.sendActivity(chatId);
      return true;
    }
    if (action === 'broadcast') {
      await this.beginBroadcast(chatId, actor);
      return true;
    }
    if (action === 'broadcast_confirm') {
      await this.confirmBroadcast(chatId, actor, id, directorAppUrl);
      return true;
    }
    if (action === 'broadcast_cancel') {
      await this.cancelBroadcast(chatId, actor, id, directorAppUrl);
      return true;
    }
    if (action === 'admin_rights') {
      await this.sendAdminRights(chatId);
      return true;
    }
    if (action === 'right_enable' || action === 'right_disable') {
      await this.setAdminRight(chatId, id, action === 'right_enable');
      return true;
    }
    if (action === 'restaurant') {
      await this.sendRestaurant(chatId);
      return true;
    }
    if (action === 'restaurant_open') {
      await this.setRestaurantState(chatId, 'open');
      return true;
    }
    if (action === 'booking_open') {
      await this.setRestaurantState(chatId, 'booking_open');
      return true;
    }
    if (action === 'booking_close') {
      await this.setRestaurantState(chatId, 'booking_closed');
      return true;
    }
    if (action === 'restaurant_close') {
      await this.setRestaurantState(chatId, 'closed');
      return true;
    }
    return false;
  }

  async handleText(text: string, chatId: string | number, actor: AuthUser) {
    this.assertDirector(actor);
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
    const message = String(text || '').trim();
    if (!message) {
      await this.telegram.sendMessage(chatId, '⚠️ Введіть текст повідомлення');
      return true;
    }
    if (message.length > 3500) {
      await this.telegram.sendMessage(chatId, '⚠️ Повідомлення занадто довге. Максимум 3500 символів.');
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
        '📣 <b>Перевірте розсилку Директора</b>',
        '',
        `Отримувачів у базі: <b>${draft.recipientCount}</b>`,
        'Повідомлення отримають гості з доступним Telegram.',
        '',
        `<blockquote>${this.escapeHtml(message)}</blockquote>`,
      ].join('\n'),
      {
        inline_keyboard: [
          [{ text: '✅ Надіслати всім', callback_data: `director:broadcast_confirm:${draftId}` }],
          [{ text: '❌ Скасувати', callback_data: `director:broadcast_cancel:${draftId}` }],
        ],
      },
    );
    return true;
  }

  private async sendBookings(chatId: string | number, requestedPage: number, directorAppUrl?: string | null) {
    const bookings: any[] = await this.bookings.getToday();
    const page = this.paginate(bookings, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map((booking: any) => [
      {
        text: `${this.bookingStatusEmoji(booking.status)} ${this.timeLabel(booking.bookingTime)} · №${booking.table?.tableNumber || '—'} · ${booking.client?.fullName || 'Гість'}`.slice(0, 60),
        callback_data: `director:booking:${booking.id}`,
      },
    ]);
    this.addPageButtons(keyboard, 'director:bookings', page.pageIndex, page.totalPages);
    if (directorAppUrl) keyboard.push([{ text: '📱 Опрацювати у повному пульті', web_app: { url: directorAppUrl } }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:director' }]);
    await this.telegram.sendMessage(
      chatId,
      bookings.length
        ? `📋 <b>Бронювання сьогодні</b> · ${bookings.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '📋 <b>Бронювання сьогодні</b>\n\nБронювань немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendBooking(chatId: string | number, id: string | undefined, directorAppUrl?: string | null) {
    if (!id) throw new BadRequestException('Бронювання не вказано');
    const bookings: any[] = await this.bookings.getToday();
    const booking = bookings.find((item: any) => item.id === id);
    if (!booking) return this.sendBookings(chatId, 0, directorAppUrl);
    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (directorAppUrl) keyboard.push([{ text: '📱 Опрацювати у повному пульті', web_app: { url: directorAppUrl } }]);
    keyboard.push([{ text: '⬅️ До бронювань', callback_data: 'director:bookings:0' }]);
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
        '',
        'ℹ️ Нові бронювання Директор уже отримує окремим Telegram push з робочими кнопками.',
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async sendReschedules(chatId: string | number, requestedPage: number, directorAppUrl?: string | null) {
    const requests: any[] = await this.bookings.getPendingReschedules();
    const page = this.paginate(requests, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map((request: any) => [
      {
        text: `🔁 №${request.booking?.table?.tableNumber || '—'} · ${this.dateLabel(request.requestedDate)} ${this.timeLabel(request.requestedTime)}`.slice(0, 60),
        callback_data: `director:reschedule:${request.id}`,
      },
    ]);
    this.addPageButtons(keyboard, 'director:reschedules', page.pageIndex, page.totalPages);
    if (directorAppUrl) keyboard.push([{ text: '📱 Опрацювати у повному пульті', web_app: { url: directorAppUrl } }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:director' }]);
    await this.telegram.sendMessage(
      chatId,
      requests.length
        ? `🔁 <b>Запити на перенесення</b> · ${requests.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '🔁 <b>Запити на перенесення</b>\n\nНових запитів немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendReschedule(chatId: string | number, id: string | undefined, directorAppUrl?: string | null) {
    if (!id) throw new BadRequestException('Запит не вказано');
    const requests: any[] = await this.bookings.getPendingReschedules();
    const request = requests.find((item: any) => item.id === id);
    if (!request) return this.sendReschedules(chatId, 0, directorAppUrl);
    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (directorAppUrl) keyboard.push([{ text: '📱 Опрацювати у повному пульті', web_app: { url: directorAppUrl } }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'director:reschedules:0' }]);
    await this.telegram.sendMessage(
      chatId,
      [
        '🔁 <b>Перенесення бронювання</b>',
        `👤 ${this.escapeHtml(request.booking?.client?.fullName || 'Гість')}`,
        `🪑 Стіл №${this.escapeHtml(String(request.booking?.table?.tableNumber || '—'))}`,
        `Було: <b>${this.dateLabel(request.booking?.bookingDate)} · ${this.timeLabel(request.booking?.bookingTime)}</b>`,
        `Просить: <b>${this.dateLabel(request.requestedDate)} · ${this.timeLabel(request.requestedTime)}</b>`,
        '',
        'ℹ️ Запит також надходить Директору окремим Telegram push з кнопками рішення.',
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async sendLocations(chatId: string | number) {
    const tables: any[] = await this.tables.findAll();
    const keyboard = LOCATIONS.map((location) => {
      const count = tables.filter((table: any) => location.accepts(Number(table.tableNumber))).length;
      return [{ text: `📍 ${location.label} · ${count}`, callback_data: `director:location:${location.key}` }];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:director' }]);
    await this.telegram.sendMessage(chatId, '🪑 <b>Локації та столи</b>\n\nУ Telegram — тільки перегляд фактичного стану.', { inline_keyboard: keyboard });
  }

  private async sendLocation(chatId: string | number, key: string | undefined, requestedPage: number) {
    const location = LOCATIONS.find((item) => item.key === key);
    if (!location) throw new BadRequestException('Локацію не знайдено');
    const tables: any[] = (await this.tables.findAll())
      .filter((table: any) => location.accepts(Number(table.tableNumber)))
      .sort((left: any, right: any) => Number(left.tableNumber) - Number(right.tableNumber));
    const page = this.paginate(tables, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map((table: any) => [
      {
        text: `${this.tableStatusEmoji(table.status)} №${table.tableNumber} · ${this.tableStatusLabel(table.status)}`,
        callback_data: `director:table:${table.id}`,
      },
    ]);
    if (page.totalPages > 1) {
      const row: Array<Record<string, unknown>> = [];
      if (page.pageIndex > 0) row.push({ text: '⬅️', callback_data: `director:location_page:${location.key},${page.pageIndex - 1}` });
      if (page.pageIndex < page.totalPages - 1) row.push({ text: '➡️', callback_data: `director:location_page:${location.key},${page.pageIndex + 1}` });
      if (row.length) keyboard.push(row);
    }
    keyboard.push([{ text: '⬅️ До локацій', callback_data: 'director:locations' }]);
    await this.telegram.sendMessage(
      chatId,
      `📍 <b>${location.label}</b>\nСторінка ${page.pageIndex + 1}/${page.totalPages}`,
      { inline_keyboard: keyboard },
    );
  }

  private async sendTable(chatId: string | number, id: string | undefined) {
    if (!id) throw new BadRequestException('Стіл не вказано');
    const table: any = (await this.tables.findAll()).find((item: any) => item.id === id);
    if (!table) throw new BadRequestException('Стіл не знайдено');
    await this.telegram.sendMessage(
      chatId,
      [
        `🪑 <b>Стіл №${this.escapeHtml(String(table.tableNumber))}</b>`,
        `Статус: <b>${this.tableStatusLabel(table.status)}</b>`,
        `📍 ${this.escapeHtml(table.zone?.name || 'Локація не вказана')}`,
        `👥 Місць: <b>${table.seats || '—'}</b>`,
        '',
        'ℹ️ Зміна статусу та план столів залишаються у повному пульті Директора.',
      ].join('\n'),
      { inline_keyboard: [[{ text: '⬅️ До локацій', callback_data: 'director:locations' }]] },
    );
  }

  private async sendTeam(chatId: string | number, requestedPage: number) {
    const staff: any[] = (await this.staff.findAll()).filter((member: any) => member.active && !member.isArchived);
    const page = this.paginate(staff, requestedPage);
    const lines = page.items.map((member: any) => `${member.isOnShift ? '🟢' : '⚪️'} <b>${this.escapeHtml(member.fullName)}</b> · ${this.roleLabel(member.role)}${member.isOnShift ? ' · на зміні' : ''}`);
    const keyboard: Array<Array<Record<string, unknown>>> = [];
    this.addPageButtons(keyboard, 'director:team', page.pageIndex, page.totalPages);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:director' }]);
    await this.telegram.sendMessage(
      chatId,
      [`👥 <b>Команда</b> · ${staff.length}`, `Сторінка ${page.pageIndex + 1}/${page.totalPages}`, '', ...(lines.length ? lines : ['Активних працівників немає.']), '', 'ℹ️ Керування змінами, архівом і видаленням — у повному пульті.'].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async sendStats(chatId: string | number) {
    const stats: any = await this.analytics.getToday();
    await this.telegram.sendMessage(
      chatId,
      [
        '📈 <b>Статистика сьогодні</b>',
        `📅 ${this.dateLabel(stats.date)}`,
        `📋 Бронювань: <b>${stats.bookingsCount || 0}</b>`,
        `⏳ Очікують: <b>${stats.pendingCount || 0}</b>`,
        `👥 Гостей: <b>${stats.guestsCount || 0}</b>`,
        `🔴 Зайнятих столів: <b>${stats.occupiedTables || 0}</b>`,
        `🟢 Вільних столів: <b>${stats.freeTables || 0}</b>`,
        `🚫 Закритих локацій: <b>${stats.closedZones || 0}</b>`,
        '',
        'Фінансові показники тут не відображаються.',
      ].join('\n'),
      { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu:director' }]] },
    );
  }

  private async sendActivity(chatId: string | number) {
    const logs: any[] = (await this.logs.findAll()).slice(0, 8);
    const lines = logs.map((log: any) => {
      const actor = log.staff?.role === 'owner' ? 'Директор' : log.staff?.fullName || 'Система';
      return `• <b>${this.escapeHtml(String(log.action || '').slice(0, 120))}</b>\n  ${this.escapeHtml(actor)} · ${this.dateTime(log.createdAt)}`;
    });
    await this.telegram.sendMessage(
      chatId,
      ['📜 <b>Останні дії персоналу</b>', '', ...(lines.length ? lines : ['Історія поки порожня.'])].join('\n'),
      { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu:director' }]] },
    );
  }

  private async beginBroadcast(chatId: string | number, actor: AuthUser) {
    const recipients = await this.broadcasts.getTargetClients('all_clients');
    if (!recipients.length) throw new BadRequestException('Немає доступних гостей для розсилки');
    const draftId = randomBytes(8).toString('hex');
    this.broadcastDrafts.set(this.actorKey(actor), {
      stage: 'awaiting_text',
      id: draftId,
      recipientCount: recipients.length,
      expiresAt: Date.now() + BROADCAST_DRAFT_TTL_MS,
    });
    await this.telegram.sendMessage(
      chatId,
      `📣 <b>Розсилка Директора</b>\n\nВведіть текст повідомлення. Отримувачів у базі: <b>${recipients.length}</b>.`,
      { inline_keyboard: [[{ text: '❌ Скасувати', callback_data: `director:broadcast_cancel:${draftId}` }]] },
    );
  }

  private async confirmBroadcast(chatId: string | number, actor: AuthUser, id: string | undefined, directorAppUrl?: string | null) {
    const key = this.actorKey(actor);
    const draft = this.broadcastDrafts.get(key);
    if (!draft || draft.stage !== 'confirm' || !id || draft.id !== id || !draft.message) {
      throw new BadRequestException('Ця кнопка розсилки вже неактуальна');
    }
    this.broadcastDrafts.delete(key);
    const result = await this.broadcasts.sendNow({ message: draft.message, target: 'all_clients' });
    await this.telegram.sendMessage(
      chatId,
      `✅ Розсилку оброблено. Доставлено: <b>${result.deliveredCount}</b>, без доступного Telegram: <b>${result.unreachableCount}</b>.`,
    ).catch(() => undefined);
    await this.sendMenu(chatId, actor, directorAppUrl).catch(() => undefined);
  }

  private async cancelBroadcast(chatId: string | number, actor: AuthUser, id: string | undefined, directorAppUrl?: string | null) {
    const key = this.actorKey(actor);
    const draft = this.broadcastDrafts.get(key);
    if (!draft || !id || draft.id !== id) throw new BadRequestException('Ця кнопка скасування вже неактуальна');
    this.broadcastDrafts.delete(key);
    await this.telegram.sendMessage(chatId, '❌ Розсилку скасовано').catch(() => undefined);
    await this.sendMenu(chatId, actor, directorAppUrl).catch(() => undefined);
  }

  private async sendAdminRights(chatId: string | number, notice?: string) {
    const restaurant: any = await this.restaurant.getRestaurant();
    const keyboard = ADMIN_RIGHTS.map((right) => {
      const enabled = Boolean(restaurant[right.field]);
      return [{
        text: `${enabled ? '✅' : '❌'} ${right.label}`,
        callback_data: `director:${enabled ? 'right_disable' : 'right_enable'}:${right.key}`,
      }];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:director' }]);
    await this.telegram.sendMessage(
      chatId,
      [notice, '👔 <b>Права Адміністратора</b>', '', 'Натискання змінює тільки конкретне право. Обробка вже створених бронювань від цих перемикачів не залежить.'].filter(Boolean).join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async setAdminRight(chatId: string | number, key: string | undefined, enabled: boolean) {
    const right = ADMIN_RIGHTS.find((item) => item.key === key);
    if (!right) throw new BadRequestException('Право не знайдено');
    const restaurant: any = await this.restaurant.getRestaurant();
    if (Boolean(restaurant[right.field]) !== enabled) {
      await this.restaurant.update({ [right.field]: enabled } as any);
    }
    await this.sendAdminRights(chatId, `${enabled ? '✅ Увімкнено' : '❌ Вимкнено'}: ${right.label}`).catch(() => undefined);
  }

  private async sendRestaurant(chatId: string | number, notice?: string) {
    const restaurant: any = await this.restaurant.getRestaurant();
    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (restaurant.status === 'closed') {
      keyboard.push([{ text: '🟢 Відкрити ресторан', callback_data: 'director:restaurant_open' }]);
    } else {
      if (restaurant.status === 'booking_closed') keyboard.push([{ text: '🟢 Відкрити онлайн-бронювання', callback_data: 'director:booking_open' }]);
      if (restaurant.status === 'open') keyboard.push([{ text: '🔒 Закрити онлайн-бронювання', callback_data: 'director:booking_close' }]);
      keyboard.push([{ text: '🔴 Закрити ресторан', callback_data: 'director:restaurant_close' }]);
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:director' }]);
    await this.telegram.sendMessage(
      chatId,
      [notice, '🏪 <b>Стан ресторану</b>', `Поточний стан: <b>${this.restaurantStatusLabel(restaurant.status)}</b>`, `🕒 Відкриття: ${restaurant.openTime || '—'} · бронювання до ${restaurant.bookingCloseTime || '—'} · закриття ${restaurant.closeTime || '—'}`].filter(Boolean).join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async setRestaurantState(chatId: string | number, target: 'open' | 'booking_open' | 'booking_closed' | 'closed') {
    const current: any = await this.restaurant.getRestaurant();
    let notice = 'ℹ️ Стан уже актуальний';
    if ((target === 'open' || target === 'booking_open') && current.status !== 'open') {
      if (target === 'open') await this.restaurant.openRestaurant();
      else await this.restaurant.openBooking();
      notice = target === 'open' ? '🟢 Ресторан відкрито' : '🟢 Онлайн-бронювання відкрито';
    } else if (target === 'booking_closed' && current.status !== 'booking_closed') {
      if (current.status === 'closed') throw new BadRequestException('Ресторан уже повністю закритий');
      await this.restaurant.closeBooking();
      notice = '🔒 Онлайн-бронювання закрито';
    } else if (target === 'closed' && current.status !== 'closed') {
      await this.restaurant.closeRestaurant({});
      notice = '🔴 Ресторан закрито';
    }
    await this.sendRestaurant(chatId, notice).catch(() => undefined);
  }

  private assertDirector(actor: AuthUser | null): asserts actor is AuthUser {
    if (!actor || actor.role !== 'owner') throw new BadRequestException('Потрібен доступ Директора');
  }

  private actorKey(actor: AuthUser) {
    return String(actor.telegramId || actor.staffId || actor.sub || '').trim();
  }

  private paginate<T>(items: T[], requestedPage: number) {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageIndex = Math.min(Math.max(0, requestedPage), totalPages - 1);
    return { items: items.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE), pageIndex, totalPages };
  }

  private addPageButtons(keyboard: Array<Array<Record<string, unknown>>>, prefix: string, pageIndex: number, totalPages: number) {
    if (totalPages <= 1) return;
    const row: Array<Record<string, unknown>> = [];
    if (pageIndex > 0) row.push({ text: '⬅️', callback_data: `${prefix}:${pageIndex - 1}` });
    if (pageIndex < totalPages - 1) row.push({ text: '➡️', callback_data: `${prefix}:${pageIndex + 1}` });
    if (row.length) keyboard.push(row);
  }

  private parsePage(value?: string) {
    const parsed = Number.parseInt(String(value ?? '0'), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private tableStatusLabel(status?: string) {
    return ({ free: 'Вільний', pending: 'Очікує', reserved: 'Заброньований', occupied: 'Зайнятий', cleaning: 'Готується', closed: 'Недоступний' } as Record<string, string>)[String(status || '')] || 'Невідомо';
  }

  private tableStatusEmoji(status?: string) {
    return ({ free: '🟢', pending: '🔵', reserved: '🟠', occupied: '🔴', cleaning: '🧽', closed: '⚫️' } as Record<string, string>)[String(status || '')] || '⚪️';
  }

  private bookingStatusLabel(status?: string) {
    return ({ pending: 'Очікує', approved: 'Підтверджено', rejected: 'Відхилено', cancelled: 'Скасовано', completed: 'Завершено' } as Record<string, string>)[String(status || '')] || String(status || 'Невідомо');
  }

  private bookingStatusEmoji(status?: string) {
    return ({ pending: '🟠', approved: '✅', rejected: '❌', cancelled: '⚫️', completed: '🟢' } as Record<string, string>)[String(status || '')] || '⚪️';
  }

  private restaurantStatusLabel(status?: string) {
    return status === 'open' ? 'відкритий' : status === 'booking_closed' ? 'бронювання закрито' : 'закритий';
  }

  private roleLabel(role?: string) {
    return role === 'owner' ? 'Директор' : role === 'admin' ? 'Адміністратор' : role === 'waiter' ? 'Офіціант' : role === 'hookah' ? 'Кальянник' : 'Працівник';
  }

  private dateLabel(value?: string | null) {
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}.${month}.${year}` : String(value);
  }

  private timeLabel(value?: string | null) {
    return value ? String(value).slice(0, 5) : '--:--';
  }

  private dateTime(value?: string | Date | null) {
    if (!value) return '—';
    return new Date(value).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  private escapeHtml(value: string) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
