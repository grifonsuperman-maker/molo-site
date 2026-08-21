import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class TelegramService {
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;
  private botUsername: string | null = null;

  private get apiUrl() {
    if (!this.botToken) {
      throw new InternalServerErrorException(
        'TELEGRAM_BOT_TOKEN не налаштовано',
      );
    }

    return `https://api.telegram.org/bot${this.botToken}`;
  }

  async registerWebhook() {
    const baseUrl = String(process.env.RENDER_EXTERNAL_URL || '').trim();
    const webhookSecret = String(
      process.env.TELEGRAM_WEBHOOK_SECRET || '',
    ).trim();

    if (!this.botToken) {
      return { configured: false, reason: 'TELEGRAM_BOT_TOKEN відсутній' };
    }

    if (!baseUrl) {
      return { configured: false, reason: 'RENDER_EXTERNAL_URL відсутній' };
    }

    if (!webhookSecret) {
      return { configured: false, reason: 'TELEGRAM_WEBHOOK_SECRET відсутній' };
    }

    const webhookUrl = new URL('/api/telegram/webhook', baseUrl).toString();
    const response = await fetch(`${this.apiUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      throw new InternalServerErrorException(
        `Telegram setWebhook error: ${JSON.stringify(payload)}`,
      );
    }

    return { configured: true, webhookUrl };
  }

  async getBotUsername() {
    const configured = String(process.env.TELEGRAM_BOT_USERNAME || '')
      .trim()
      .replace(/^@/, '');

    if (configured) return configured;
    if (this.botUsername) return this.botUsername;

    const payload = await this.call('getMe', {});
    const username = String(payload?.result?.username || '')
      .trim()
      .replace(/^@/, '');

    if (!username) {
      throw new InternalServerErrorException(
        'Не вдалося визначити username Telegram-бота',
      );
    }

    this.botUsername = username;
    return username;
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    replyMarkup?: unknown,
  ) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }

  async deleteMessage(chatId: string | number, messageId: string | number) {
    return this.call('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  private async call(method: string, body: Record<string, unknown>) {
    const response = await fetch(`${this.apiUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Telegram error: ${await response.text()}`,
      );
    }

    return response.json();
  }
}
