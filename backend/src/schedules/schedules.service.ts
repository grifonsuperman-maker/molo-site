import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { LogsService } from '../logs/logs.service';

type RestaurantReminderKind = 'booking' | 'restaurant';

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,

    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,

    private readonly notificationsService: NotificationsService,
    private readonly logsService: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runEveryMinute() {
    await this.checkLateGuests();
    await this.checkBookingCloseReminder();
    await this.checkRestaurantCloseReminder();
  }

  private getKyivClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    const minute = value('minute');

    if (!year || !month || !day || !hour || !minute) {
      throw new Error('Could not determine the current Kyiv date and time');
    }

    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
      minutes: Number(hour) * 60 + Number(minute),
    };
  }

  private minutesFromTime(time: string) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private async getRestaurant() {
    const restaurants = await this.restaurantRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    if (restaurants[0]) {
      return restaurants[0];
    }

    const restaurant = this.restaurantRepo.create({
      name: 'MOLO',
      phone: null,
      address: null,
      menuUrl:
        'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio',
      logoUrl: '/logo.png',
      mainPhotoUrl: '/logo.png',
      openTime: '10:00',
      bookingCloseTime: '22:00',
      closeTime: '23:00',
      status: 'open',
      closeMessage: 'Ресторан зараз зачинений.\nМи працюємо з 10:00 до 23:00.',
      bookingClosedMessage:
        'Онлайн-бронювання завершено.\nДля бронювання зателефонуйте адміністратору.',
      mapWidth: 1600,
      mapHeight: 1000,
      bookingCloseNotifiedAt: null,
      restaurantCloseNotifiedAt: null,
    });

    return this.restaurantRepo.save(restaurant);
  }

  private async claimRestaurantReminder(
    restaurantId: string,
    today: string,
    currentMinutes: number,
    kind: RestaurantReminderKind,
  ): Promise<string | null> {
    return this.restaurantRepo.manager.transaction(async (manager) => {
      const restaurantRepo = manager.getRepository(Restaurant);
      const restaurant = await restaurantRepo.findOne({
        where: { id: restaurantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!restaurant) {
        return null;
      }

      const reminderTime =
        kind === 'booking'
          ? restaurant.bookingCloseTime.slice(0, 5)
          : restaurant.closeTime.slice(0, 5);

      if (currentMinutes < this.minutesFromTime(reminderTime)) {
        return null;
      }

      const alreadyNotified =
        kind === 'booking'
          ? restaurant.bookingCloseNotifiedAt
          : restaurant.restaurantCloseNotifiedAt;

      if (alreadyNotified === today) {
        return null;
      }

      if (kind === 'booking') {
        restaurant.bookingCloseNotifiedAt = today;
      } else {
        restaurant.restaurantCloseNotifiedAt = today;
      }

      await restaurantRepo.save(restaurant);

      return reminderTime;
    });
  }

  private async releaseRestaurantReminder(
    restaurantId: string,
    today: string,
    kind: RestaurantReminderKind,
  ) {
    await this.restaurantRepo.manager.transaction(async (manager) => {
      const restaurantRepo = manager.getRepository(Restaurant);
      const restaurant = await restaurantRepo.findOne({
        where: { id: restaurantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!restaurant) {
        return;
      }

      const notifiedAt =
        kind === 'booking'
          ? restaurant.bookingCloseNotifiedAt
          : restaurant.restaurantCloseNotifiedAt;

      if (notifiedAt !== today) {
        return;
      }

      if (kind === 'booking') {
        restaurant.bookingCloseNotifiedAt = null;
      } else {
        restaurant.restaurantCloseNotifiedAt = null;
      }

      await restaurantRepo.save(restaurant);
    });
  }

  private async checkLateGuests() {
    const { date: today, minutes: nowMinutes } = this.getKyivClock();

    const bookings = await this.bookingsRepo.find({
      where: {
        bookingDate: today,
        status: 'approved',
      },
      relations: ['table', 'client'],
    });

    for (const booking of bookings) {
      if (booking.lateNotifiedAt) {
        continue;
      }

      const bookingMinutes = this.minutesFromTime(booking.bookingTime);
      const isLate = nowMinutes >= bookingMinutes + 15;

      if (!isLate) {
        continue;
      }

      booking.lateNotifiedAt = new Date();

      await this.bookingsRepo.save(booking);
      await this.notificationsService.notifyLateGuest(booking);

      await this.logsService.create('Відправлено сповіщення про запізнення гостя', null, {
        bookingId: booking.id,
        tableNumber: booking.table?.tableNumber,
        clientName: booking.client?.fullName,
        bookingTime: booking.bookingTime,
      });
    }
  }

  private async checkBookingCloseReminder() {
    const restaurant = await this.getRestaurant();

    if (!restaurant) {
      return;
    }

    const { date: today, minutes: currentMinutes } = this.getKyivClock();
    const closeBookingTime = restaurant.bookingCloseTime.slice(0, 5);
    const closeBookingMinutes = this.minutesFromTime(closeBookingTime);

    if (currentMinutes < closeBookingMinutes) {
      return;
    }

    if (restaurant.bookingCloseNotifiedAt === today) {
      return;
    }

    const claimedReminderTime = await this.claimRestaurantReminder(
      restaurant.id,
      today,
      currentMinutes,
      'booking',
    );

    if (!claimedReminderTime) {
      return;
    }

    const delivery = await this.notificationsService.notifyBookingCloseReminder();

    if (delivery && delivery.attempted > 0 && delivery.delivered === 0) {
      await this.releaseRestaurantReminder(restaurant.id, today, 'booking');
      this.logger.warn('Не вдалося доставити нагадування про закриття онлайн-бронювання; повторимо');
      return;
    }

    await this.logsService.create('Відправлено нагадування закрити онлайн-бронювання', null, {
      time: claimedReminderTime,
    });
  }

  private async checkRestaurantCloseReminder() {
    const restaurant = await this.getRestaurant();

    if (!restaurant) {
      return;
    }

    const { date: today, minutes: currentMinutes } = this.getKyivClock();
    const closeRestaurantTime = restaurant.closeTime.slice(0, 5);
    const closeRestaurantMinutes = this.minutesFromTime(closeRestaurantTime);

    if (currentMinutes < closeRestaurantMinutes) {
      return;
    }

    if (restaurant.restaurantCloseNotifiedAt === today) {
      return;
    }

    const claimedReminderTime = await this.claimRestaurantReminder(
      restaurant.id,
      today,
      currentMinutes,
      'restaurant',
    );

    if (!claimedReminderTime) {
      return;
    }

    const delivery = await this.notificationsService.notifyRestaurantCloseReminder();

    if (delivery && delivery.attempted > 0 && delivery.delivered === 0) {
      await this.releaseRestaurantReminder(restaurant.id, today, 'restaurant');
      this.logger.warn('Не вдалося доставити нагадування про закриття ресторану; повторимо');
      return;
    }

    await this.logsService.create('Відправлено нагадування закрити ресторан', null, {
      time: claimedReminderTime,
    });
  }
}
