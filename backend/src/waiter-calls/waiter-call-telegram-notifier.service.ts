import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramService } from '../notifications/telegram.service';
import { Staff } from '../staff/entities/staff.entity';
import type { WaiterCall } from './waiter-calls.service';

@Injectable()
export class WaiterCallTelegramNotifierService {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,
    private readonly telegram: TelegramService,
  ) {}

  async notifyCreated(
    call: WaiterCall,
    activeCalls: WaiterCall[],
    timingStartedAtMs?: number,
  ) {
    const staff = await this.staffRepo.find({
      where: {
        role: 'waiter',
        active: true,
        isArchived: false,
        isOnShift: true,
      },
    });

    const recipients = staff.filter(
      (person) =>
        Boolean(person.telegramId) &&
        (!call.waiterId || person.id === call.waiterId),
    );

    this.logTiming(
      'recipients_resolved',
      call.id,
      timingStartedAtMs,
      { recipientCount: recipients.length },
    );

    if (!recipients.length) {
      this.logTiming('telegram_skipped_no_recipients', call.id, timingStartedAtMs);
      return { attempted: 0, delivered: 0, failed: 0 };
    }

    this.logTiming(
      'telegram_send_started',
      call.id,
      timingStartedAtMs,
      { recipientCount: recipients.length },
    );

    const results = await Promise.allSettled(
      recipients.map((person) => {
        const activeCount = activeCalls.filter(
          (item) => !item.waiterId || item.waiterId === person.id,
        ).length;

        const text = [
          '🔔 <b>Новий виклик Офіціанта</b>',
          '',
          `🪑 Стіл №<b>${this.escapeHtml(call.tableNumber || '—')}</b>`,
          `👤 Гість: <b>${this.escapeHtml(call.clientName || 'Гість')}</b>`,
          `🔔 Активних викликів: <b>${activeCount}</b>`,
        ].join('\n');

        return this.telegram.sendMessage(person.telegramId as string, text, {
          inline_keyboard: [
            [
              {
                text: '✅ Прийняв',
                callback_data: `waiter:call_accept:${call.id}`,
              },
            ],
            [
              {
                text: `🔔 Виклики · ${activeCount}`,
                callback_data: 'waiter:calls',
              },
            ],
          ],
        });
      }),
    );

    const delivered = results.filter(
      (result) => result.status === 'fulfilled',
    ).length;

    this.logTiming(
      'telegram_confirmed',
      call.id,
      timingStartedAtMs,
      {
        attempted: results.length,
        delivered,
        failed: results.length - delivered,
      },
    );

    return {
      attempted: results.length,
      delivered,
      failed: results.length - delivered,
    };
  }

  private logTiming(
    stage: string,
    callId: string,
    timingStartedAtMs?: number,
    details: Record<string, unknown> = {},
  ) {
    if (timingStartedAtMs == null) return;

    console.info(
      '[waiter-call-timing]',
      JSON.stringify({
        stage,
        callId,
        elapsedMs: Date.now() - timingStartedAtMs,
        ...details,
      }),
    );
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
