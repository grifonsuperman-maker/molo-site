# MOLO Restaurant

Telegram Mini App + Web Admin Panel + Backend API для бронювання столиків ресторану MOLO.

## Модулі

- Гостьовий Telegram Mini App
- Панель офіціанта
- Панель Кальянника
- Адмін-панель
- Пульт Директора
- Backend API на NestJS
- Telegram Bot webhook
- PostgreSQL

## Запуск бази даних

```bash
docker compose up -d
```

## Запуск backend

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```

## Запуск frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Telegram webhook

Після деплою backend:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-domain.com/api/telegram/webhook
```

## Production

Актуальний приклад production-змінних знаходиться в `backend/.env.production.example`.

У production:

- `JWT_SECRET` обов'язковий;
- `TELEGRAM_WEBHOOK_SECRET` обов'язковий;
- `DB_SYNCHRONIZE=false`;
- `ALLOW_DEV_AUTH=false`.

Backend перевіряє production secrets під час запуску. Dev-auth не повинен використовуватись у production.

## Авторизація та ролі

Система використовує Telegram Mini App `initData`.

### Ролі

- `guest` — гість
- `waiter` — офіціант
- `admin` — адміністратор
- `owner` — Директор

### Як працює вхід

1. Користувач відкриває Telegram Mini App.
2. Frontend відправляє `initData` на backend:

```http
POST /api/auth/telegram
```

3. Backend перевіряє підпис Telegram через `TELEGRAM_BOT_TOKEN`.
4. Якщо Telegram ID є в таблиці `staff`, користувач отримує роль персоналу.
5. Якщо Telegram ID немає в `staff`, користувач отримує роль `guest`.
6. Backend повертає JWT access token.

### Локальне тестування без Telegram

Dev-auth дозволений тільки для локальної development-сесії:

```env
NODE_ENV=development
ALLOW_DEV_AUTH=true
```

У production і на Render dev-auth заблокований незалежно від значення `ALLOW_DEV_AUTH`.

### Захист API

- Публічні маршрути позначені `@Public()`.
- Службові маршрути захищені JWT.
- Права доступу задаються через `@Roles(...)`.

## Автоматичні нагадування

Backend перевіряє події щохвилини:

- через 15 хвилин після підтвердженого часу бронювання надсилає адміну сповіщення про запізнення гостя;
- о 22:00 надсилає кнопку `Закрити онлайн-бронювання`;
- о 23:00 надсилає кнопку `Закрити ресторан`.
