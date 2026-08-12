import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { assertProductionSecrets } from './config/runtime-secrets';
import { TelegramService } from './notifications/telegram.service';

async function bootstrap() {
  assertProductionSecrets();

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`MOLO backend started on port ${port}`);

  try {
    const telegram = app.get(TelegramService);
    const result = await telegram.registerWebhook();
    if (result.configured) {
      console.log(`Telegram webhook configured: ${result.webhookUrl}`);
    } else {
      console.warn(`Telegram webhook skipped: ${result.reason}`);
    }
  } catch (error) {
    console.error(
      'Telegram webhook setup failed:',
      error instanceof Error ? error.message : error,
    );
  }
}
bootstrap();
