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

## Перевірка legacy migrations

У репозиторії є вісім старих migration-файлів, яких немає в поточному runtime migration list. Їх не можна реєструвати або запускати поверх production лише тому, що частина `up` використовує `IF NOT EXISTS`.

Для офлайн-перевірки їхніх schema-ефектів використовується:

```bash
node backend/scripts/legacy-migration-audit.mjs schema-baseline.json
```

Скрипт **не підключається до PostgreSQL і не виконує SQL**. Він читає вже отриманий `schema-audit.json` або нормалізований `schema-baseline.json` та перевіряє очікувані таблиці, колонки, constraints, indexes і extensions для всіх восьми legacy migrations. Перевіряються не лише імена index/constraint, а й ключові частини їхніх definitions.

Результат окремо показує:

- чи присутні всі schema artifacts кожної legacy migration;
- чи є якась legacy migration вже записаною в TypeORM `migrations` history;
- які schema artifacts відсутні;
- які migrations потребують ручної перевірки даних.

`AddHookahCallAvailability1786057200000` має історичні `UPDATE` для `hookah_calls`, тому schema snapshot **не може довести**, що ці data changes колись виконувалися. Навіть повний успіх schema-artifact audit не дозволяє автоматично запускати, реєструвати або вручну позначати legacy migrations виконаними.

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
