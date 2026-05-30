import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TelegramService } from './telegram.service';
import { Staff } from '../staff/entities/staff.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingRescheduleRequest } from '../bookings/entities/booking-reschedule-request.entity';

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

    return staff.filter((person) => Boolean(person.telegramId)).map((person) => person.telegramId as string);
  }

  async sendToRoles(roles: Array<'owner' | 'admin' | 'waiter'>, text: string, replyMarkup?: unknown) {
    const chatIds = await this.getActiveStaffTelegramIds(roles);
    await Promise.allSettled(chatIds.map((chatId) => this.telegramService.sendMessage(chatId, text, replyMarkup)));
  }

  async notifyNewBooking(booking: Booking) {
    const text = [
      '🟠 <b>Нове бронювання</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${booking.client?.fullName || '-'}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${booking.bookingTime}</b>`,
      `👥 Гостей: <b>${booking.guestsCount}</b>`,
      `📝 Побажання: ${booking.wishes || '-'}`,
    ].join('
');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Підтвердити', callback_data: `booking:approve:${booking.id}` },
          { text: '❌ Відхилити', callback_data: `booking:reject:${booking.id}` },
        ],
        [{ text: '📞 Подзвонити', callback_data: `booking:call:${booking.id}` }],
      ],
    };

    await this.sendToRoles(['owner', 'admin', 'waiter'], text, replyMarkup);
  }

  async notifyBookingApproved(booking: Booking) {
    const text = [
      '✅ <b>Бронювання підтверджено</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${booking.client?.fullName || '-'}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${booking.bookingTime}</b>`,
    ].join('
');

    await this.sendToRoles(['owner', 'admin', 'waiter'], text);
  }

  async notifyBookingCancelled(booking: Booking) {
    const text = [
      '❌ <b>Бронювання скасовано</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${booking.client?.fullName || '-'}</b>`,
      `📅 Дата: <b>${booking.bookingDate}</b>`,
      `🕒 Час: <b>${booking.bookingTime}</b>`,
    ].join('
');

    await this.sendToRoles(['owner', 'admin', 'waiter'], text);
  }

  async notifyRescheduleRequest(request: BookingRescheduleRequest) {
    const booking = request.booking;
    const text = [
      '⏰ <b>Запит на перенесення бронювання</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${booking.client?.fullName || '-'}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      '',
      `Було: <b>${booking.bookingDate} ${booking.bookingTime}</b>`,
      `Нове: <b>${request.requestedDate} ${request.requestedTime}</b>`,
    ].join('
');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Погодити', callback_data: `reschedule:approve:${request.id}` },
          { text: '❌ Відмовити', callback_data: `reschedule:reject:${request.id}` },
        ],
        [{ text: '📞 Подзвонити', callback_data: `booking:call:${booking.id}` }],
      ],
    };

    await this.sendToRoles(['owner', 'admin'], text, replyMarkup);
  }

  async notifyLateGuest(booking: Booking) {
    const text = [
      '⚠️ <b>Гість запізнюється</b>',
      '',
      `🪑 Стіл: <b>${booking.table?.tableNumber || '-'}</b>`,
      `👤 Імʼя: <b>${booking.client?.fullName || '-'}</b>`,
      `📞 Телефон: <b>${booking.client?.phone || '-'}</b>`,
      `🕒 Час бронювання: <b>${booking.bookingTime}</b>`,
      '',
      'Минуло 15 хвилин після часу бронювання.',
    ].join('
');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '📞 Подзвонити', callback_data: `booking:call:${booking.id}` },
          { text: '❌ Скасувати', callback_data: `booking:cancel:${booking.id}` },
        ],
        [{ text: '⏰ Змінити час', callback_data: `booking:change_time:${booking.id}` }],
      ],
    };

    await this.sendToRoles(['owner', 'admin'], text, replyMarkup);
  }

  async notifyBookingCloseReminder() {
    const text = [
      '🕙 <b>22:00</b>',
      '',
      'Закрити онлайн-бронювання?',
      'Після закриття буде доступний тільки дзвінок адміністратору.',
    ].join('
');

    const replyMarkup = {
      inline_keyboard: [[{ text: '🔒 Закрити бронювання', callback_data: 'restaurant:close_booking' }]],
    };

    await this.sendToRoles(['owner', 'admin'], text, replyMarkup);
  }

  async notifyRestaurantCloseReminder() {
    const text = [
      '🕚 <b>23:00</b>',
      '',
      'Закрити ресторан повністю?',
      'Після закриття не працюватимуть бронювання, дзвінки та активна карта.',
    ].join('
');

    const replyMarkup = {
      inline_keyboard: [[{ text: '🔴 Закрити ресторан', callback_data: 'restaurant:close_full' }]],
    };

    await this.sendToRoles(['owner', 'admin'], text, replyMarkup);
  }
}
