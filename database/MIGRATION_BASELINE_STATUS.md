# MOLO migration baseline status

## Зафіксований стан

Цей документ фіксує перевірений стан database runtime перед окремим рішенням щодо production `DB_SYNCHRONIZE=false`.

Базовий commit застосунку для перевірки:

```text
72453e592d3cc5840c4bdc1062a3e436735d98fd
```

## Перевірка `synchronize: false`

18 серпня 2026 року backend було окремо запущено з `DB_SYNCHRONIZE=false` проти ізольованої Neon branch `db-baseline-test`, створеної від production.

До та після запуску read-only health check показав однаковий критичний snapshot:

- database: `neondb`;
- public tables: `20`;
- indexes: `39`;
- TypeORM migration rows: `5`;
- views: `0`;
- `uuid-ossp`: доступний;
- booking indexes: присутні;
- waiter indexes: присутні;
- waiter trigger: присутній;
- waiter function: присутня.

Backend успішно стартував у цьому режимі. Після перевірки тимчасовий Render service було зупинено.

Ця перевірка підтверджує лише те, що **поточна production-подібна схема достатня для запуску поточного backend без TypeORM schema synchronize**. Вона не створює і не доводить повний bootstrap нової порожньої бази лише з migration history.

## Фактично зареєстровані migrations

На момент перевірки 18 серпня `AppModule` реєстрував п'ять runtime migration classes:

1. `CreateStaffPinAttempts2026081400010`;
2. `UpgradeStaffPinAttemptsPerAttempt2026081400020`;
3. `CreateWaiterCalls2026081500010`;
4. `AddWaiterCallAssignmentActive2026081500015`;
5. `CloseInactiveWaiterCalls2026081500020`.

Після цього baseline runtime migration list було розширено ще двома migrations:

6. `AddGuestReviewArchive2026082200010`;
7. `AddLogArchive2026082400010`.

Станом на поточний `main` `AppModule` реєструє сім runtime migration classes. Історичний snapshot вище навмисно залишається з п'ятьма migration rows, тому що саме такий стан було перевірено 18 серпня.

У `backend/src/migrations` є також старіші migration-файли, які не входять до поточного runtime migration list. Їх не можна автоматично реєструвати, позначати виконаними або запускати поверх production без окремого schema audit та перевірки походження кожної зміни.

## Межі цього baseline

- `database/schema.sql` залишається historical bootstrap і не є джерелом істини для production.
- Старі migration-файли не запускаються і не додаються до runtime list цим етапом.
- Production schema/data цим документом не змінюються.
- Production `DB_SYNCHRONIZE` цим етапом не змінюється.
- Окремий production runtime switch має бути самостійним керованим кроком після ручного погодження.
- Повний fresh-database migration bootstrap залишається окремою задачею; його не можна підміняти фальшивою baseline-міграцією або ручним заповненням таблиці `migrations`.
- Усі майбутні schema changes мають іти через TypeORM migrations із безпечними `up`/`down`, як вимагає `AGENTS.md`.

## Чого цей запис не робить

Цей запис не містить DDL/DML, не виконується runtime-застосунком, не змінює frontend, Telegram, карти, столи, координати, click zones, фото/image paths, робочі кнопки, polling 15 секунд або test role switcher.
