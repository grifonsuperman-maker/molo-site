# Backend Docker deploy

Backend можна запускати як Docker-сервіс.

## Build

```bash
docker build -t molo-backend ./backend
```

## Run

```bash
docker run -p 3000:3000 --env-file backend/.env.production.example molo-backend
```

У production треба використовувати реальний `.env`, а не `.env.production.example`.
