import { BadRequestException, Injectable } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { AvailabilityBlocksService } from '../bookings/availability-blocks.service';
import { BookingTableLockService } from '../bookings/booking-table-lock.service';
import { BookingsService } from '../bookings/bookings.service';
import type { CreateAdminManualBookingDto } from '../bookings/dto/create-admin-manual-booking.dto';
import { TelegramService } from '../notifications/telegram.service';
import { TablesService } from '../tables/tables.service';

const BOOKING_DRAFT_TTL_MS = 10 * 60 * 1000;

type BookingDraftStage = 'date' | 'table' | 'time' | 'name' | 'guests' | 'phone' | 'confirm';

type BookingDraft = {
  id: string;
  stage: BookingDraftStage;
  bookingDate?: string;
  tableId?: string;
  tableNumber?: string;
  bookingTime?: string;
  fullName?: string;
  guestsCount?: number;
  phone?: string;
  expiresAt: number;
};

@Injectable()
export class TelegramAdminBookingCreateService {
  private readonly drafts = new Map<string, BookingDraft>();

  constructor(
    private readonly bookings: BookingsService,
    private readonly tableLock: BookingTableLockService,
    private readonly availabilityBlocks: AvailabilityBlocksService,
    private readonly tables: TablesService,
    private readonly telegram: TelegramService,
  ) {}

  hasPendingInput(telegramId: string) {
    const key = String(telegramId || '').trim();
    if (!key) return false;
    const draft = this.drafts.get(key);
    if (!draft) return false;
    if (draft.expiresAt <= Date.now()) {
      this.drafts.delete(key);
      return false;
    }
    return true;
  }

  clearPendingInput(telegramId: string) {
    const key = String(telegramId || '').trim();
    if (key) this.drafts.delete(key);
  }

  async begin(chatId: string | number, actor: AuthUser) {
    this.assertAdminActor(actor);
    const key = this.actorKey(actor);
    const draft: BookingDraft = {
      id: this.randomDraftId(),
      stage: 'date',
      expiresAt: Date.now() + BOOKING_DRAFT_TTL_MS,
    };
    this.drafts.set(key, draft);

    await this.telegram.sendMessage(
      chatId,
      [
        '➕ <b>Створити бронювання</b>',
        '',
        'Крок 1/6 · Оберіть дату або надішліть її повідомленням.',
        'Формат: <b>ДД.ММ</b> або <b>YYYY-MM-DD</b>.',
        '',
        'Для скасування надішліть /cancel.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: 'Сьогодні',
              callback_data: `admin:booking:create_date_today_${draft.id}`,
            },
            {
              text: 'Завтра',
              callback_data: `admin:booking:create_date_tomorrow_${draft.id}`,
            },
          ],
          [
            {
              text: '❌ Скасувати',
              callback_data: `admin:booking:create_cancel_${draft.id}`,
            },
          ],
        ],
      },
    );
  }

  async handleAction(
    actionId: string | undefined,
    chatId: string | number,
    actor: AuthUser,
  ) {
    this.assertAdminActor(actor);
    if (actionId === 'create') {
      await this.begin(chatId, actor);
      return true;
    }

    const key = this.actorKey(actor);
    const draft = this.activeDraft(key);
    if (!draft || !actionId) {
      throw new BadRequestException('Ця кнопка вже неактуальна. Почніть створення бронювання заново.');
    }

    if (actionId === `create_cancel_${draft.id}`) {
      this.drafts.delete(key);
      await this.telegram.sendMessage(
        chatId,
        '❌ Створення бронювання скасовано.',
        { inline_keyboard: [[{ text: '⬅️ До пульта', callback_data: 'menu:admin' }]] },
      );
      return true;
    }

    if (actionId === `create_date_today_${draft.id}`) {
      this.assertStage(draft, 'date');
      await this.acceptDate(chatId, draft, this.kyivDate(0));
      return true;
    }

    if (actionId === `create_date_tomorrow_${draft.id}`) {
      this.assertStage(draft, 'date');
      await this.acceptDate(chatId, draft, this.kyivDate(1));
      return true;
    }

    if (actionId === `create_skip_phone_${draft.id}`) {
      this.assertStage(draft, 'phone');
      draft.phone = undefined;
      draft.stage = 'confirm';
      this.touch(draft);
      await this.sendConfirmation(chatId, draft);
      return true;
    }

    if (actionId === `create_confirm_${draft.id}`) {
      this.assertStage(draft, 'confirm');
      await this.confirm(chatId, key, draft, actor);
      return true;
    }

    throw new BadRequestException('Ця кнопка вже неактуальна. Перевірте останній крок бронювання.');
  }

  async handleText(text: string, chatId: string | number, actor: AuthUser) {
    this.assertAdminActor(actor);
    const key = this.actorKey(actor);
    const draft = this.activeDraft(key);
    if (!draft) return false;

    const value = String(text || '').trim();
    if (value === '/cancel') {
      this.drafts.delete(key);
      await this.telegram.sendMessage(
        chatId,
        '❌ Створення бронювання скасовано.',
        { inline_keyboard: [[{ text: '⬅️ До пульта', callback_data: 'menu:admin' }]] },
      );
      return true;
    }

    if (draft.stage === 'date') {
      const bookingDate = this.parseDate(value);
      if (!bookingDate) {
        await this.telegram.sendMessage(
          chatId,
          '⚠️ Невірна дата. Надішліть ДД.ММ, YYYY-MM-DD, «сьогодні» або «завтра».',
        );
        return true;
      }
      await this.acceptDate(chatId, draft, bookingDate);
      return true;
    }

    if (draft.stage === 'table') {
      const match = value.match(/^№?\s*(\d+)$/u);
      if (!match) {
        await this.telegram.sendMessage(chatId, '⚠️ Надішліть тільки номер столу, наприклад 15.');
        return true;
      }
      const tableNumber = match[1];
      const table = (await this.tables.findAll()).find(
        (item: any) => String(item.tableNumber) === tableNumber && item.isVisible !== false,
      );
      if (!table) {
        await this.telegram.sendMessage(chatId, `⚠️ Стіл №${this.escapeHtml(tableNumber)} не знайдено або він прихований.`);
        return true;
      }
      draft.tableId = table.id;
      draft.tableNumber = String(table.tableNumber);
      draft.stage = 'time';
      this.touch(draft);
      await this.telegram.sendMessage(
        chatId,
        `Крок 3/6 · Стіл №<b>${this.escapeHtml(draft.tableNumber)}</b>. Надішліть час у форматі <b>HH:MM</b>, наприклад 18:30.`,
        this.cancelMarkup(draft),
      );
      return true;
    }

    if (draft.stage === 'time') {
      const bookingTime = this.parseTime(value);
      if (!bookingTime) {
        await this.telegram.sendMessage(chatId, '⚠️ Невірний час. Надішліть його у форматі HH:MM, наприклад 18:30.');
        return true;
      }
      draft.bookingTime = bookingTime;
      draft.stage = 'name';
      this.touch(draft);
      await this.telegram.sendMessage(
        chatId,
        'Крок 4/6 · Надішліть ім’я гостя.',
        this.cancelMarkup(draft),
      );
      return true;
    }

    if (draft.stage === 'name') {
      if (!value) {
        await this.telegram.sendMessage(chatId, '⚠️ Вкажіть ім’я гостя.');
        return true;
      }
      if (value.length > 120) {
        await this.telegram.sendMessage(chatId, '⚠️ Ім’я занадто довге. Максимум 120 символів.');
        return true;
      }
      draft.fullName = value;
      draft.stage = 'guests';
      this.touch(draft);
      await this.telegram.sendMessage(
        chatId,
        'Крок 5/6 · Скільки гостей? Надішліть число.',
        this.cancelMarkup(draft),
      );
      return true;
    }

    if (draft.stage === 'guests') {
      const guestsCount = Number(value);
      if (!Number.isInteger(guestsCount) || guestsCount < 1) {
        await this.telegram.sendMessage(chatId, '⚠️ Кількість гостей має бути цілим числом від 1.');
        return true;
      }
      draft.guestsCount = guestsCount;
      draft.stage = 'phone';
      this.touch(draft);
      await this.telegram.sendMessage(
        chatId,
        [
          'Крок 6/6 · Надішліть номер телефону гостя.',
          '',
          '<b>Телефон необов’язковий.</b> Можна натиснути «Пропустити».',
        ].join('\n'),
        {
          inline_keyboard: [
            [
              {
                text: '⏭ Пропустити телефон',
                callback_data: `admin:booking:create_skip_phone_${draft.id}`,
              },
            ],
            [
              {
                text: '❌ Скасувати',
                callback_data: `admin:booking:create_cancel_${draft.id}`,
              },
            ],
          ],
        },
      );
      return true;
    }

    if (draft.stage === 'phone') {
      const lower = value.toLocaleLowerCase('uk');
      if (value === '-' || lower === 'пропустити' || lower === 'без телефону') {
        draft.phone = undefined;
      } else {
        const digits = value.replace(/\D/g, '');
        if (!digits) {
          await this.telegram.sendMessage(
            chatId,
            '⚠️ Надішліть номер телефону або натисніть «Пропустити телефон».',
          );
          return true;
        }
        draft.phone = value;
      }
      draft.stage = 'confirm';
      this.touch(draft);
      await this.sendConfirmation(chatId, draft);
      return true;
    }

    await this.telegram.sendMessage(chatId, 'ℹ️ Використайте кнопки під останнім повідомленням.');
    return true;
  }

  private async acceptDate(chatId: string | number, draft: BookingDraft, bookingDate: string) {
    if (bookingDate < this.kyivDate(0)) {
      this.touch(draft);
      await this.telegram.sendMessage(
        chatId,
        '⚠️ Минула дата недоступна. Оберіть сьогодні або майбутню дату.',
        this.cancelMarkup(draft),
      );
      return;
    }

    draft.bookingDate = bookingDate;
    draft.stage = 'table';
    this.touch(draft);
    await this.telegram.sendMessage(
      chatId,
      [
        `Крок 2/6 · Дата: <b>${this.dateLabel(bookingDate)}</b>.`,
        'Надішліть номер столу, наприклад <b>15</b>.',
      ].join('\n'),
      this.cancelMarkup(draft),
    );
  }

  private async sendConfirmation(chatId: string | number, draft: BookingDraft) {
    if (
      !draft.bookingDate ||
      !draft.tableId ||
      !draft.tableNumber ||
      !draft.bookingTime ||
      !draft.fullName ||
      !draft.guestsCount
    ) {
      throw new BadRequestException('Дані бронювання неповні. Почніть створення заново.');
    }

    await this.telegram.sendMessage(
      chatId,
      [
        '✅ <b>Перевірте бронювання</b>',
        '',
        `📅 ${this.dateLabel(draft.bookingDate)} · 🕒 ${this.escapeHtml(draft.bookingTime)}`,
        `🪑 Стіл №<b>${this.escapeHtml(draft.tableNumber)}</b>`,
        `👤 ${this.escapeHtml(draft.fullName)}`,
        `👥 Гостей: <b>${draft.guestsCount}</b>`,
        `📞 ${draft.phone ? this.escapeHtml(draft.phone) : 'не вказано'}`,
        '',
        'Після підтвердження бронювання буде одразу підтвердженим.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '✅ Створити бронювання',
              callback_data: `admin:booking:create_confirm_${draft.id}`,
            },
          ],
          [
            {
              text: '❌ Скасувати',
              callback_data: `admin:booking:create_cancel_${draft.id}`,
            },
          ],
        ],
      },
    );
  }

  private async confirm(
    chatId: string | number,
    key: string,
    draft: BookingDraft,
    actor: AuthUser,
  ) {
    if (
      !draft.bookingDate ||
      !draft.tableId ||
      !draft.tableNumber ||
      !draft.bookingTime ||
      !draft.fullName ||
      !draft.guestsCount
    ) {
      throw new BadRequestException('Дані бронювання неповні. Почніть створення заново.');
    }

    const dto: CreateAdminManualBookingDto = {
      tableId: draft.tableId,
      fullName: draft.fullName,
      ...(draft.phone ? { phone: draft.phone } : {}),
      bookingDate: draft.bookingDate,
      bookingTime: draft.bookingTime,
      guestsCount: draft.guestsCount,
    };

    // Видаляємо draft до запису: повторне натискання старої кнопки не може
    // створити другу ручну бронь. Таблиця при цьому все одно проходить
    // той самий advisory lock + availability guard, що й ручна бронь на сайті.
    this.drafts.delete(key);

    let result: any;
    try {
      result = await this.tableLock.withCreateLock(dto, async () => {
        await this.availabilityBlocks.assertBookable(dto);
        return this.bookings.createManual(dto, actor);
      });
    } catch (cause) {
      await this.telegram.sendMessage(
        chatId,
        [
          '❌ <b>Бронювання не створено</b>',
          this.escapeHtml(this.errorMessage(cause)),
          '',
          'Дані не збережено. Почніть створення заново.',
        ].join('\n'),
        {
          inline_keyboard: [
            [{ text: '➕ Спробувати ще раз', callback_data: 'admin:booking:create' }],
            [{ text: '⬅️ До пульта', callback_data: 'menu:admin' }],
          ],
        },
      );
      return;
    }

    try {
      await this.telegram.sendMessage(
        chatId,
        [
          '✅ <b>Бронювання створено</b>',
          `📅 ${this.dateLabel(result.bookingDate)} · 🕒 ${this.timeLabel(result.bookingTime)}`,
          `🪑 Стіл №<b>${this.escapeHtml(draft.tableNumber)}</b>`,
          `👤 ${this.escapeHtml(draft.fullName)}`,
          `👥 Гостей: <b>${draft.guestsCount}</b>`,
          `📞 ${draft.phone ? this.escapeHtml(draft.phone) : 'не вказано'}`,
          '',
          'Статус: <b>Підтверджено</b>',
        ].join('\n'),
        {
          inline_keyboard: [
            [{ text: '📋 Бронювання сьогодні', callback_data: 'admin:bookings:0' }],
            [{ text: '➕ Створити ще', callback_data: 'admin:booking:create' }],
            [{ text: '⬅️ До пульта', callback_data: 'menu:admin' }],
          ],
        },
      );
    } catch (cause) {
      console.error(
        'Telegram admin booking receipt delivery failed after persistence',
        cause,
      );
    }
  }

  private activeDraft(key: string) {
    const draft = this.drafts.get(key);
    if (!draft) return null;
    if (draft.expiresAt <= Date.now()) {
      this.drafts.delete(key);
      return null;
    }
    return draft;
  }

  private assertStage(draft: BookingDraft, stage: BookingDraftStage) {
    if (draft.stage !== stage) {
      throw new BadRequestException('Ця кнопка вже неактуальна. Перевірте останній крок бронювання.');
    }
  }

  private touch(draft: BookingDraft) {
    draft.expiresAt = Date.now() + BOOKING_DRAFT_TTL_MS;
  }

  private cancelMarkup(draft: BookingDraft) {
    return {
      inline_keyboard: [
        [
          {
            text: '❌ Скасувати',
            callback_data: `admin:booking:create_cancel_${draft.id}`,
          },
        ],
      ],
    };
  }

  private parseDate(value: string) {
    const lower = value.toLocaleLowerCase('uk');
    if (lower === 'сьогодні') return this.kyivDate(0);
    if (lower === 'завтра') return this.kyivDate(1);

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return this.isCalendarDate(value) ? value : null;
    }

    const short = value.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
    if (!short) return null;
    const [, dayRaw, monthRaw, yearRaw] = short;
    const currentYear = this.kyivDate(0).slice(0, 4);
    const normalized = `${yearRaw || currentYear}-${monthRaw.padStart(2, '0')}-${dayRaw.padStart(2, '0')}`;
    return this.isCalendarDate(normalized) ? normalized : null;
  }

  private isCalendarDate(value: string) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  private parseTime(value: string) {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private kyivDate(offsetDays: number) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value || 1970);
    const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
    const day = Number(parts.find((part) => part.type === 'day')?.value || 1);
    return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
  }

  private dateLabel(value: string) {
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}.${month}.${year}` : value;
  }

  private timeLabel(value: string) {
    return String(value || '').slice(0, 5);
  }

  private actorKey(actor: AuthUser) {
    const key = String(actor.telegramId || actor.staffId || actor.sub || '').trim();
    if (!key) throw new BadRequestException('Не вдалося визначити Адміністратора');
    return key;
  }

  private assertAdminActor(actor: AuthUser | null): asserts actor is AuthUser {
    if (!actor || (actor.role !== 'admin' && actor.role !== 'owner')) {
      throw new BadRequestException('Команда доступна лише Адміністратору або Директору');
    }
  }

  private randomDraftId() {
    return Math.random().toString(36).slice(2, 10);
  }

  private errorMessage(cause: unknown) {
    const error = cause as any;
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    if (typeof response === 'string') return response;
    if (Array.isArray(response?.message)) return response.message.join('; ');
    if (typeof response?.message === 'string') return response.message;
    if (typeof error?.message === 'string') return error.message;
    return 'Невідома помилка';
  }

  private escapeHtml(value: string) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
