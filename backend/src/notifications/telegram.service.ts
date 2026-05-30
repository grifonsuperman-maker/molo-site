import { Injectable, InternalServerErrorException } from '@nestjs/common';
@Injectable()
export class TelegramService {
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;
  private get apiUrl(){ if(!this.botToken) throw new InternalServerErrorException('TELEGRAM_BOT_TOKEN не налаштовано'); return `https://api.telegram.org/bot${this.botToken}`; }
  async sendMessage(chatId: string|number, text:string, replyMarkup?:unknown){
    const response=await fetch(`${this.apiUrl}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',reply_markup:replyMarkup})});
    if(!response.ok){ throw new InternalServerErrorException(`Telegram error: ${await response.text()}`); }
    return response.json();
  }
}
