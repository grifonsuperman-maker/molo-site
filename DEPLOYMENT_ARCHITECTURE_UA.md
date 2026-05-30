# MOLO Restaurant — схема розгортання

Цей проєкт потрібно розгортати так:

## 1. GitHub
Увесь код зберігається в одному GitHub репозиторії:

```text
molo-restaurant/
├── frontend/   # Telegram Mini App + адмін-панель
├── backend/    # API + Telegram webhook
├── database/   # PostgreSQL schema
└── docker-compose.yml
```

## 2. Vercel
На Vercel розміщується тільки `frontend/`:

- гостьовий Mini App;
- панель офіціанта;
- адмін-панель;
- конструктор залу.

Vercel повинен мати змінну:

```env
VITE_API_URL=https://YOUR_BACKEND_DOMAIN/api
```

## 3. Сервер для backend + Telegram
Окремо розміщується `backend/`:

- NestJS API;
- Telegram webhook;
- Telegram-сповіщення;
- автоматичні нагадування о 22:00 та 23:00;
- перевірка запізнення гостя через 15 хвилин.

Для backend потрібні змінні:

```env
PORT=3000
DB_HOST=...
DB_PORT=5432
DB_USER=...
DB_PASSWORD=...
DB_NAME=...
JWT_SECRET=...
TELEGRAM_BOT_TOKEN=...
ALLOW_DEV_AUTH=false
```

## 4. PostgreSQL
База даних має бути PostgreSQL.

Можна використовувати:

- окремий сервер;
- хмарну PostgreSQL базу;
- VPS;
- сервіс, який дає PostgreSQL.

## 5. Telegram Bot
Telegram Bot працює через webhook на backend:

```text
https://YOUR_BACKEND_DOMAIN/api/telegram/webhook
```

Після запуску backend треба встановити webhook:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://YOUR_BACKEND_DOMAIN/api/telegram/webhook
```

## Важливо
З телефону власник ресторану буде користуватись уже готовою системою.
Початкове розгортання в GitHub, Vercel і на backend-сервері краще зробити розробнику.
