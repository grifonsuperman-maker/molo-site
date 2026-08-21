import { BadRequestException, Injectable } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { HookahCallsService } from '../hookah-calls/hookah-calls.service';
import { TelegramService } from '../notifications/telegram.service';

const PAGE_SIZE = 10;
const ETA_MINUTES = [5, 10, 20, 30] as const;

@Injectable()
export class TelegramHookahMenuService {
  constructor(
    private readonly hookahCalls: HookahCallsService,
    private readonly telegram: TelegramService,
  ) {}

  async sendMenu(chatId: string | number, hookahAppUrl?: string | null) {
    const [active, mine, availability] = await Promise.all([
      this.hookahCalls.listActive(),
      this.hookahCalls.listMineFromTelegram?.('') ?? Promise.resolve([]),
      this.hookahCalls.availability(),
    ]).catch(async () => {
      const activeCalls = await this.hookahCalls.listActive();
      const available = await this.hookahCalls.availability();
      return [activeCalls, [], available] as const;
    });

    const newCount = active.filter((call) => call.status === 'new').length;
    const keyboard: Array<Array<Record<string, unknown>>> = [
      [
        {
          text: `🔔 Нові виклики · ${newCount}`,
          callback_data: 'hookah:calls',
        },
        {
          text: `✅ Мої виклики · ${mine.length}`,
          callback_data: 'hookah:mine',
        },
      ],
      [
        {
          text: availability.available
            ? '🚫 Немає вільних кальянів'
            : '🟢 Кальяни доступні',
          callback_data: availability.available
            ? 'hookah:availability_off'
            : 'hookah:availability_on',
        },
      ],
    ];

    if (hookahAppUrl) {
      keyboard.push([
        {
          text: '📱 Відкрити повний пульт',
          web_app: { url: hookahAppUrl },
        },
      ]);
    }

    await this.telegram.sendMessage(
      chatId,
      '💨 <b>Пульт Кальянника</b>\n\nОберіть дію:',
      { inline_keyboard: keyboard },
    );
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
    hookahAppUrl?: string | null,
  ) {
    if (!actor?.staffId || actor.role !== 'hookah') {
      throw new BadRequestException('Команда доступна лише Кальяннику на зміні');
    }

    if (action === 'calls') {
      await this.sendCalls(chatId, this.parsePage(id));
      return true;
    }
    if (action === 'call') {
      await this.sendCall(chatId, id);
      return true;
    }
    if (action.startsWith('accept_')) {
      const etaMinutes = Number(action.slice('accept_'.length));
      if (!ETA_MINUTES.includes(etaMinutes as (typeof ETA_MINUTES)[number])) {
        throw new BadRequestException('Некоректний час очікування');
      }
      await this.acceptCall(chatId, id, actor.staffId, etaMinutes);
      return true;
    }
    if (action === 'mine') {
      await this.sendMine(chatId, actor.staffId, this.parsePage(id));
      return true;
    }
    if (action === 'mine_call') {
      await this.sendMineCall(chatId, id, actor.staffId);
      return true;
    }
    if (action === 'complete') {
      await this.completeCall(chatId, id, actor.staffId);
      return true;
    }
    if (action === 'availability_on' || action === 'availability_off') {
      await this.hookahCalls.setAvailability(
        actor.staffId,
        action === 'availability_on',
      );
      await this.sendMenu(chatId, hookahAppUrl);
      return true;
    }

    return false;
  }

  private async sendCalls(chatId: string | number, requestedPage = 0) {
    const active = await this.hookahCalls.listActive();
    const calls = active.filter((call) => call.status === 'new');
    const page = this.paginate(calls, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (call) => [
        {
          text: `🔔 Стіл №${call.tableNumber || '—'} · ${call.clientName || 'Гість'}`.slice(
            0,
            60,
          ),
          callback_data: `hookah:call:${call.id}`,
        },
      ],
    );

    const pageButtons: Array<Record<string, unknown>> = [];
    if (page.pageIndex > 0) {
      pageButtons.push({
        text: '⬅️',
        callback_data: `hookah:calls:${page.pageIndex - 1}`,
      });
    }
    if (page.pageIndex + 1 < page.totalPages) {
      pageButtons.push({
        text: '➡️',
        callback_data: `hookah:calls:${page.pageIndex + 1}`,
      });
    }
    if (pageButtons.length) keyboard.push(pageButtons);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:hookah' }]);

    await this.telegram.sendMessage(
      chatId,
      calls.length
        ? `🔔 <b>Нові виклики Кальянника</b> · ${calls.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '🔔 <b>Нові виклики Кальянника</b>\n\nНових викликів немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendCall(chatId: string | number, id: string | undefined) {
    if (!id) throw new BadRequestException('Виклик не вказано');
    const active = await this.hookahCalls.listActive();
    const call = active.find((item) => item.id === id && item.status === 'new');

    if (!call) {
      await this.sendCalls(chatId, 0);
      return;
    }

    await this.telegram.sendMessage(
      chatId,
      [
        '🔔 <b>Виклик Кальянника</b>',
        `🪑 Стіл №${this.escapeHtml(call.tableNumber || '—')}`,
        `📍 Локація: ${this.escapeHtml(call.zoneName || '—')}`,
        `👤 Гість: ${this.escapeHtml(call.clientName || 'Гість')}`,
        `👨‍🍳 Офіціант: ${this.escapeHtml(call.waiterName || 'не закріплений')}`,
        '',
        'Коли будете біля столу?',
      ].join('\n'),
      {
        inline_keyboard: [
          ETA_MINUTES.map((minutes) => ({
            text: `${minutes} хв`,
            callback_data: `hookah:accept_${minutes}:${call.id}`,
          })),
          [{ text: '⬅️ До викликів', callback_data: 'hookah:calls' }],
        ],
      },
    );
  }

  private async acceptCall(
    chatId: string | number,
    id: string | undefined,
    staffId: string,
    etaMinutes: number,
  ) {
    if (!id) throw new BadRequestException('Виклик не вказано');
    await this.hookahCalls.accept(id, staffId, { etaMinutes });
    await this.sendMine(chatId, staffId, 0, `✅ Виклик прийнято · ${etaMinutes} хв`);
  }

  private async sendMine(
    chatId: string | number,
    staffId: string,
    requestedPage = 0,
    notice?: string,
  ) {
    const calls = await this.hookahCalls.listMine(staffId);
    const page = this.paginate(calls, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (call) => [
        {
          text: `✅ Стіл №${call.tableNumber || '—'} · ${call.etaMinutes || '—'} хв`.slice(
            0,
            60,
          ),
          callback_data: `hookah:mine_call:${call.id}`,
        },
      ],
    );

    const pageButtons: Array<Record<string, unknown>> = [];
    if (page.pageIndex > 0) {
      pageButtons.push({
        text: '⬅️',
        callback_data: `hookah:mine:${page.pageIndex - 1}`,
      });
    }
    if (page.pageIndex + 1 < page.totalPages) {
      pageButtons.push({
        text: '➡️',
        callback_data: `hookah:mine:${page.pageIndex + 1}`,
      });
    }
    if (pageButtons.length) keyboard.push(pageButtons);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:hookah' }]);

    const title = calls.length
      ? `✅ <b>Мої виклики</b> · ${calls.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
      : '✅ <b>Мої виклики</b>\n\nАктивних викликів немає.';

    await this.telegram.sendMessage(
      chatId,
      notice ? `${notice}\n\n${title}` : title,
      { inline_keyboard: keyboard },
    );
  }

  private async sendMineCall(
    chatId: string | number,
    id: string | undefined,
    staffId: string,
  ) {
    if (!id) throw new BadRequestException('Виклик не вказано');
    const mine = await this.hookahCalls.listMine(staffId);
    const call = mine.find((item) => item.id === id);

    if (!call) {
      await this.sendMine(chatId, staffId, 0);
      return;
    }

    await this.telegram.sendMessage(
      chatId,
      [
        '✅ <b>Мій виклик</b>',
        `🪑 Стіл №${this.escapeHtml(call.tableNumber || '—')}`,
        `📍 Локація: ${this.escapeHtml(call.zoneName || '—')}`,
        `👤 Гість: ${this.escapeHtml(call.clientName || 'Гість')}`,
        `⏱ Обіцяно: ${call.etaMinutes || '—'} хв`,
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '🟢 Виконано',
              callback_data: `hookah:complete:${call.id}`,
            },
          ],
          [{ text: '⬅️ До моїх викликів', callback_data: 'hookah:mine' }],
        ],
      },
    );
  }

  private async completeCall(
    chatId: string | number,
    id: string | undefined,
    staffId: string,
  ) {
    if (!id) throw new BadRequestException('Виклик не вказано');
    await this.hookahCalls.complete(id, staffId);
    await this.sendMine(chatId, staffId, 0, '🟢 Виклик виконано');
  }

  private parsePage(value: string | undefined) {
    const page = Number(value);
    return Number.isInteger(page) && page >= 0 ? page : 0;
  }

  private paginate<T>(items: T[], requestedPage: number) {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageIndex = Math.min(Math.max(0, requestedPage), totalPages - 1);
    const start = pageIndex * PAGE_SIZE;
    return {
      items: items.slice(start, start + PAGE_SIZE),
      pageIndex,
      totalPages,
    };
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
