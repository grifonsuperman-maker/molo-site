import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TelegramService } from './telegram.service';
import { Staff } from '../staff/entities/staff.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingRescheduleRequest } from '../bookings/entities/booking-reschedule-request.entity';

type GuestReportedLatenessNotification = {
  tableNumber?: string | null;
  bookingDate: string;
  bookingTime: string;
  latenessHours?: number | null;
  latenessMinutes?: number | null;
};

type GuestRescheduleDecisionNotification = {
  telegramId?: string | null;
  decision: 'approved' | 'rejected';
  bookingDate: string;
  bookingTime: string;
  adminComment?: string | null;
};

export type NotificationDeliverySummary = {
  attempted: number;
  delivered: number;
  failed: number;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Staff) private readonly staffRepo: Repository<Staff>,
    private readonly telegramService: TelegramService,
  ) {}

  async getActiveStaffTelegramIds(roles: Array<'owner' | 'admin' | 'waiter'>) {
    const staff = await this.staffRepo.find({
      where: { role: In(roles), active: true },
    });

    return staff
      .filter(
        (person) =>
          Boolean(person.telegramId) &&
          (person.role !== 'waiter' || person.isOnShift),
      )
      .map((person) => person.telegramId as string);
  }

  async sendToRoles(
    roles: Array<'owner' | 'admin' | 'waiter'>,
    text: string,
    replyMarkup?: unknown,
  ): Promise<NotificationDeliverySummary> {
    const chatIds = await this.getActiveStaffTelegramIds(roles);

    if (!chatIds.length) {
      console.log('Telegram notification skipped: no active staff telegram ids');
      return { attempted: 0, delivered: 0, failed: 0 };
    }

    const results = await Promise.allSettled(
      chatIds.map((chatId) =>
        this.telegramService.sendMessage(chatId, text, replyMarkup),
      ),
    );
    const delivered = results.filter((result) => result.status === 'fulfilled').length;

    return {
      attempted: results.length,
      delivered,
      failed: results.length - delivered,
    };
  }

  private timeLabel(time: string | null | undefined) {
    if (!time) return '-';
    const [hours = '00', minutes = '00'] = String(time).split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private latenessLabel(hoursValue: number | null | undefined, minutesValue: number | null | undefined) {
    const hours = Math.max(0, Number(hoursValue || 0));
    const minutes = Math.max(0, Number(minutesValue || 0));
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} год`);
    if (minutes > 0) parts.push(`${minutes} хв`);
    return parts.join(' ') || '-';
  }

  private bookingGuestName(booking: Booking) {
    const rawName = booking.source === 'admin_manual'
      ? booking.guestName || booking.client?.fullName || '-'
      : booking.client?.fullName || booking.guestName || '-';
    return this.escapeHtml(String(rawName));
  }

  private bookingTimeRange(booking: Booking) {
    const anyBooking = booking as any;

    if (anyBooking.departureTime) {
      return `${this.timeLabel(booking.bookingTime)} — ${this.timeLabel(anyBooking.departureTime)}`;
    }

    const wishes = booking.wishes || '';
    const match = wishes.match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);

    if (match) {
      return `${match[1]} — ${match[2]}`;
    }

    return this.timeLabel(booking.bookingTime);
  }

  private availableFromLabel(booking: Booking) {
    const anyBooking = booking as any;

    if (anyBooking.availableFrom) {
      return this.timeLabel(anyBooking.availableFrom);
    }

    const wishes = booking.wishes || '';
    const match = wishes.match(/наступний гість з\s+(\d{2}:\d{2})/i);

    return match?.[1] || '-';
  }

  private durationLine(booking: Booking) {
    const anyBooking = booking as any;

    if (anyBooking.durationMinutes) {
      const minutes = Number(anyBooking.durationMinutes);
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;

      if (hours > 0 && rest > 0) return `${hours} год ${rest} хв`;
      if (hours > 0) return `${hours} год`;
      return `${minutes} хв`;
    }

    const wishes = booking.wishes || '';
    const match = wishes.match(/Час відпочинку:\s*([^\n]+)/i);

    return match?.[1] || '-';
  }

  private isLongBooking(booking: Booking) {
    const anyBooking = booking as any;

    if (Number(anyBooking.durationMinutes || 0) > 180) {
      return true;
    }

    const wishes = booking.wishes || '';
    const match = wishes.match(/Час відпочинку:\s*(\d+)\s*хв/i);

    return match ? Number(match[1]) > 180 : false;
  }

  async notifyNewBooking(booking: Booking) {
    const longBookingLine = this.isLongBooking(booking) ? '⚠️ <b>Довге бронювання</b>' : null;

    const text = [
      '🟠 <b>Нове бронювання</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${this.bookingGuestName(booking)}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${this.bookingTimeRange(booking)}</b>`,
      `⏳ Відпочинок: <b>${this.durationLine(booking)}</b>`,
      `🧽 Наступний гість з: <b>${this.availableFromLabel(booking)}</b>`,
      longBookingLine,
      `👥 Гостей: <b>${booking.guestsCount}</b>`,
      `📝 Побажання: ${booking.wishes || '-'}`,
    ].filter(Boolean).join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Підтвердити', callback_data: `booking:approve:${booking.id}` },
          { text: '❌ Відхилити', callback_data: `booking:reject:${booking.id}` },
        ],
      ],
    };

    await Promise.all([
      this.sendToRoles(['admin'], text, replyMarkup),
      this.sendToRoles(['waiter'], text),
    ]);
  }

  async notifyManualBookingCreated(booking: Booking) {
    const longBookingLine = this.isLongBooking(booking) ? '⚠️ <b>Довге бронювання</b>' : null;

    const text = [
      '🟠 <b>Нове бронювання</b>',
      '✍️ Створено Адміністратором',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${this.bookingGuestName(booking)}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${this.bookingTimeRange(booking)}</b>`,
      `⏳ Відпочинок: <b>${this.durationLine(booking)}</b>`,
      `🧽 Наступний гість з: <b>${this.availableFromLabel(booking)}</b>`,
      longBookingLine,
      `👥 Гостей: <b>${booking.guestsCount}</b>`,
      `📝 Побажання: ${booking.wishes || '-'}`,
    ].filter(Boolean).join('\n');

    await this.sendToRoles(['waiter'], text);
  }

  async notifyBookingApproved(booking: Booking) {
    const text = [
      '✅ <b>Бронювання підтверджено</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${this.bookingGuestName(booking)}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${this.bookingTimeRange(booking)}</b>`,
    ].join('\n');

    await this.sendToRoles(['admin', 'waiter'], text);
  }

  async notifyBookingCancelled(booking: Booking) {
    const text = [
      '❌ <b>Бронювання скасовано</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${this.bookingGuestName(booking)}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${this.bookingTimeRange(booking)}</b>`,
    ].join('\n');

    await this.sendToRoles(['admin', 'waiter'], text);
  }

  async notifyRescheduleRequest(request: BookingRescheduleRequest) {
    const booking = request.booking;
    const text = [
      '⏰ <b>Запит на перенесення бронювання</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${this.bookingGuestName(booking)}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      '',
      `Було: <b>${booking.bookingDate} ${this.timeLabel(booking.bookingTime)}</b>`,
      `Нове: <b>${request.requestedDate} ${this.timeLabel(request.requestedTime)}</b>`,
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Погодити', callback_data: `reschedule:approve:${request.id}` },
          { text: '❌ Відмовити', callback_data: `reschedule:reject:${request.id}` },
        ],
      ],
    };

    await this.sendToRoles(['admin'], text, replyMarkup);
  }

  async notifyGuestRescheduleDecision(
    notification: GuestRescheduleDecisionNotification,
  ): Promise<NotificationDeliverySummary> {
    const telegramId = String(notification.telegramId || '').trim();
    if (!telegramId) {
      return { attempted: 0, delivered: 0, failed: 0 };
    }

    const approved = notification.decision === 'approved';
    const adminComment = String(notification.adminComment || '').trim();
    const escapedAdminComment = this.escapeHtml(adminComment);
    const text = [
      approved
        ? '✅ <b>Зміну часу бронювання підтверджено</b>'
        : '❌ <b>Зміну часу бронювання не підтверджено</b>',
      '',
      approved
        ? `📅 Нова дата: <b>${notification.bookingDate}</b>`
        : `📅 Бронювання: <b>${notification.bookingDate}</b>`,
      approved
        ? `🕒 Новий час: <b>${this.timeLabel(notification.bookingTime)}</b>`
        : `🕒 Час залишається: <b>${this.timeLabel(notification.bookingTime)}</b>`,
      !approved && adminComment ? `💬 Причина: ${escapedAdminComment}` : null,
    ].filter(Boolean).join('\n');

    await this.telegramService.sendMessage(telegramId, text);
    return { attempted: 1, delivered: 1, failed: 0 };
  }

  async notifyGuestReportedLateness(booking: GuestReportedLatenessNotification) {
    const text = [
      '⚠️ <b>Гість повідомив про запізнення</b>',
      '',
      `🪑 Стіл: <b>${booking.tableNumber || '-'}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час бронювання: <b>${this.timeLabel(booking.bookingTime)}</b>`,
      `⏳ Запізнення: <b>${this.latenessLabel(booking.latenessHours, booking.latenessMinutes)}</b>`,
    ].join('\n');

    await this.sendToRoles(['admin'], text);
  }

  async notifyLateGuest(booking: Booking) {
    const text = [
      '⚠️ <b>Гість запізнюється</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${this.bookingGuestName(booking)}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      `🕒 Час бронювання: <b>${this.timeLabel(booking.bookingTime)}</b>`,
      '',
      'Минуло 15 хвилин після часу бронювання.',
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '❌ Скасувати', callback_data: `booking:cancel:${booking.id}` }],
      ],
    };

    await this.sendToRoles(['admin'], text, replyMarkup);
  }

  async notifyBookingCloseReminder() {
    const text = [
      '🕙 <b>22:00</b>',
      '',
      'Закрити онлайн-бронювання?',
      'Після закриття буде доступний тільки дзвінок адміністратору.',
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [[{ text: '🔒 Закрити бронювання', callback_data: 'restaurant:close_booking' }]],
    };

    return this.sendToRoles(['admin'], text, replyMarkup);
  }

  async notifyRestaurantCloseReminder() {
    const text = [
      '🕚 <b>23:00</b>',
      '',
      'Закрити ресторан повністю?',
      'Після закриття не працюватимуть бронювання, дзвінки та активна карта.',
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [[{ text: '🔴 Закрити ресторан', callback_data: 'restaurant:close_full' }]],
    };

    return this.sendToRoles(['admin'], text, replyMarkup);
  }
}
