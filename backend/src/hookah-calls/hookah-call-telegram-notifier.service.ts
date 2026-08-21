import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramService } from '../notifications/telegram.service';
import { Staff } from '../staff/entities/staff.entity';

type HookahTelegramCall = {
  id: string;
  tableNumber: string | null;
  zoneName: string | null;
  clientName: string | null;
  waiterName: string | null;
  status: string;
};

@Injectable()
export class HookahCallTelegramNotifierService {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,
    private readonly telegram: TelegramService,
  ) {}

  async notifyCreated(
    call: HookahTelegramCall,
    activeCalls: HookahTelegramCall[],
  ) {
    const staff = await this.staffRepo.find({
      where: {
        role: 'hookah',
        active: true,
        isArchived: false,
        isOnShift: true,
      },
    });

    const recipients = staff.filter((person) => Boolean(person.telegramId));
    if (!recipients.length) {
      return { attempted: 0, delivered: 0, failed: 0 };
    }

    const newCount = activeCalls.filter((item) => item.status === 'new').length;
    const results = await Promise.allSettled(
      recipients.map((person) =>
        this.telegram.sendMessage(
          person.telegramId as string,
          [
            '🔔 <b>Новий виклик Кальянника</b>',
            '',
            `🪑 Стіл №<b>${this.escapeHtml(call.tableNumber || '—')}</b>`,
            `📍 Локація: <b>${this.escapeHtml(call.zoneName || '—')}</b>`,
            `👤 Гість: <b>${this.escapeHtml(call.clientName || 'Гість')}</b>`,
            `👨‍🍳 Офіціант: <b>${this.escapeHtml(call.waiterName || 'не закріплений')}</b>`,
            `🔔 Нових викликів: <b>${newCount}</b>`,
          ].join('\n'),
          {
            inline_keyboard: [
              [
                {
                  text: '5 хв',
                  callback_data: `hookah:accept_5:${call.id}`,
                },
                {
                  text: '10 хв',
                  callback_data: `hookah:accept_10:${call.id}`,
                },
                {
                  text: '20 хв',
                  callback_data: `hookah:accept_20:${call.id}`,
                },
                {
                  text: '30 хв',
                  callback_data: `hookah:accept_30:${call.id}`,
                },
              ],
              [
                {
                  text: `🔔 Нові виклики · ${newCount}`,
                  callback_data: 'hookah:calls',
                },
              ],
            ],
          },
        ),
      ),
    );

    const delivered = results.filter(
      (result) => result.status === 'fulfilled',
    ).length;

    return {
      attempted: results.length,
      delivered,
      failed: results.length - delivered,
    };
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
