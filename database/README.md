# MOLO database baseline

## Поточний статус

`database/schema.sql` — історичний bootstrap-файл ранньої версії MOLO. Він **не є актуальною схемою production** і його не можна виконувати поверх поточної бази даних.

Актуальний стан PostgreSQL потрібно знімати read-only скриптом:

```bash
node backend/scripts/schema-audit.mjs > schema-audit.json
```

Скрипт `schema-audit.mjs` працює в `REPEATABLE READ READ ONLY` транзакції та збирає метадані схеми, включно з таблицями, колонками, enum, constraints, indexes, triggers, functions, sequences, views і TypeORM migration history.

## Підготовка стабільного baseline

Знімок містить мінливі технічні поля на кшталт часу зняття та версії PostgreSQL. Для стабільного файлу baseline використовується офлайн-нормалізатор:

```bash
node backend/scripts/schema-baseline.mjs schema-audit.json > schema-baseline.json
```

`schema-baseline.mjs` не підключається до PostgreSQL і не виконує SQL. Він лише перевіряє структуру вже отриманого JSON, прибирає мінливі поля та стабілізує порядок ключів. Порядок масивів із read-only audit зберігається, зокрема порядок значень enum.

## Перевірка без TypeORM synchronize

Runtime-перемикач `DB_SYNCHRONIZE` дозволяє окремо перевірити backend на ізольованій копії production. Значення читається через `ConfigService` після завантаження environment/.env конфігурації:

- якщо `DB_SYNCHRONIZE` не задано, поточна поведінка зберігається: `synchronize: true`;
- `DB_SYNCHRONIZE=false` вимикає TypeORM schema synchronize;
- `DB_SYNCHRONIZE=true` вмикає його явно;
- будь-яке інше задане значення, включно з порожнім, зупиняє запуск із зрозумілою помилкою замість неоднозначного режиму.

### Перевірено 18 серпня 2026

Ізольований backend на commit `72453e592d3cc5840c4bdc1062a3e436735d98fd` успішно стартував із `DB_SYNCHRONIZE=false` проти Neon branch `db-baseline-test`, створеної від production. Read-only health check до та після запуску зберіг однаковий критичний snapshot: 20 public tables, 39 indexes, 5 TypeORM migration rows, 0 views і наявні очікувані booking/waiter indexes, waiter trigger/function та `uuid-ossp`.

Детальний запис і межі цієї перевірки: [`MIGRATION_BASELINE_STATUS.md`](./MIGRATION_BASELINE_STATUS.md).

Це підтверджує, що **поточна production-подібна схема достатня для успішного запуску перевіреного backend без TypeORM schema synchronize**. Перевірка не доводить повну працездатність усіх runtime-сценаріїв у такому режимі та не є повним migration bootstrap для нової порожньої бази.

## Важливі обмеження

На цьому етапі:

- production продовжує працювати з поточною поведінкою `synchronize: true`, доки `DB_SYNCHRONIZE` там не задано;
- старі migration-файли не реєструються і не запускаються;
- production schema і production data не змінюються;
- `database/schema.sql` не використовується як джерело істини;
- жодних DDL/DML операцій baseline-процес не виконує;
- не можна вручну підміняти migration baseline вставками в таблицю `migrations` без окремої перевірки.

## Наступні окремі кроки

1. Production runtime switch на `DB_SYNCHRONIZE=false` робиться окремим керованим кроком після ручного погодження та перевірки поточного production environment.
2. Повний fresh-database migration bootstrap залишається окремою задачею: потрібно окремо визначити безпечний baseline для нової порожньої БД, не запускаючи старі migration-файли поверх чинного production.

Ці два сценарії не потрібно змішувати: вимкнення TypeORM synchronize для **вже існуючої перевіреної production schema** і відтворення **нової порожньої БД** — різні задачі з різними ризиками.
