# Завдання для розробника

Потрібно розгорнути MVP системи бронювання MOLO Restaurant.

## Архітектура

- Frontend: React + Vite + Tailwind, папка `frontend/`.
- Backend: NestJS + TypeORM, папка `backend/`.
- Database: PostgreSQL, файл `database/schema.sql`.
- Telegram: webhook через backend `/api/telegram/webhook`.

## Що зробити

1. Створити GitHub репозиторій.
2. Завантажити весь код у репозиторій.
3. Створити PostgreSQL базу.
4. Виконати `database/schema.sql`.
5. Розгорнути backend на сервері з HTTPS.
6. Додати змінні середовища backend:

```env
PORT=3000
DB_HOST=
DB_PORT=5432
DB_USER=
DB_PASSWORD=
DB_NAME=
JWT_SECRET=
TELEGRAM_BOT_TOKEN=
ALLOW_DEV_AUTH=false
```

7. Розгорнути frontend на Vercel з root directory `frontend`.
8. Додати змінну frontend:

```env
VITE_API_URL=https://BACKEND_DOMAIN/api
```

9. Встановити Telegram webhook:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://BACKEND_DOMAIN/api/telegram/webhook
```

10. Перевірити:

- відкриття frontend;
- створення бронювання;
- повідомлення в Telegram;
- підтвердження бронювання;
- панель офіціанта;
- адмін-панель;
- конструктор залу.

## Важливо

Це стартова MVP-збірка. Можуть бути помилки збірки або дрібні несумісності, які потрібно виправити під час першого запуску.
