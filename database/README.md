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

Runtime-перемикач `DB_SYNCHRONIZE` дозволяє окремо керувати TypeORM schema synchronize. Значення читається через `ConfigService` після завантаження environment/.env конфігурації:

- поза production, якщо `DB_SYNCHRONIZE` не задано, зберігається legacy-поведінка `synchronize: true`;
- `DB_SYNCHRONIZE=false` вимикає TypeORM schema synchronize;
- `DB_SYNCHRONIZE=true` вмикає його явно поза production;
- будь-яке інше задане значення, включно з порожнім, зупиняє запуск із зрозумілою помилкою замість неоднозначного режиму;
- у production/Render backend додатково вимагає **явно** `DB_SYNCHRONIZE=false` і зупиняється до старту Nest application, якщо змінна відсутня або дорівнює `true`.

### Перевірено 18 серпня 2026

Ізольований backend на commit `72453e592d3cc5840c4bdc1062a3e436735d98fd` успішно стартував із `DB_SYNCHRONIZE=false` проти Neon branch `db-baseline-test`, створеної від production. Read-only health check до та після запуску зберіг однаковий критичний snapshot: 20 public tables, 39 indexes, 5 TypeORM migration rows, 0 views і наявні очікувані booking/waiter indexes, waiter trigger/function та `uuid-ossp`.

Детальний запис і межі цієї перевірки: [`MIGRATION_BASELINE_STATUS.md`](./MIGRATION_BASELINE_STATUS.md).

Це підтверджує, що **поточна production-подібна схема достатня для успішного запуску перевіреного backend без TypeORM schema synchronize**. Перевірка не доводить повну працездатність усіх runtime-сценаріїв у такому режимі.

### Production switch і smoke test 19–20 серпня 2026

Production `molo-backend` на commit `fd3a733f5c65ae01045f4aa8e903531e9673842f` було перезапущено після оновлення environment із `DB_SYNCHRONIZE=false`; Render показав успішний deploy і `Live`, backend стартував на port 3000 та налаштував Telegram webhook.

Після switch вручну перевірено основний production flow без повернення `synchronize`: guest UI/карти/фото, читання існуючої броні, створення нової броні, підтвердження Адміністратором, відображення броні Офіціанту, виклики Офіціанта/Кальянника та завантаження пульта Директора. Це є runtime smoke test, а не повний schema audit.

## Fresh-only initial migration

`InitialSchemaBaseline2026081300000` призначена **лише для нової disposable/щойно створеної БД**, щоб відтворити pre-runtime MOLO schema, після чого застосовуються поточні runtime migrations із `EXPECTED_RUNTIME_MIGRATIONS` (зараз їх сім).

Вона навмисно не намагається автоматично визнати існуючу production schema baseline-станом:

- non-empty TypeORM migration history блокує `up()`;
- наявність будь-якої з 17 pre-runtime MOLO tables блокує `up()`;
- pre-existing `uuid-ossp` блокує `up()`, щоб `down()` міг однозначно прибрати extension, створений саме цим fresh bootstrap;
- baseline не реєструється в `AppModule` і не входить до production runtime migration list;
- migration не є універсальним аудитом усього PostgreSQL catalog і не повинна запускатися на довільній існуючій БД.

CI для цього baseline працює тільки з одноразовим локальним PostgreSQL 17: окремо будує current schema reference, створює нову БД через `CREATE DATABASE`, застосовує baseline + runtime migrations, порівнює результат із current schema та перевіряє full down path.

## Два migration-history шляхи

Initial baseline **не потрібно заднім числом додавати** в migration history уже існуючої production-БД, доки він залишається виключеним із runtime migration list.

Підтримуються два окремі шляхи:

- existing production: наявна runtime migration history без initial baseline → наступні runtime migrations;
- fresh database: `InitialSchemaBaseline2026081300000` → поточні runtime migrations → наступні runtime migrations.

Disposable PostgreSQL CI перевіряє обидва шляхи реальною майбутньою probe-migration: вона повинна застосуватися як наступна migration і коректно відкотитися першою. Для existing-production шляху CI додатково доводить, що initial baseline row відсутній, а після probe apply/undo schema повертається точно до current reference.

Якщо в майбутньому initial baseline коли-небудь буде потрібно додати до runtime migration list, це буде окрема зміна архітектури з окремою перевіркою. Поточний production history вручну не переписується.

## Важливі обмеження

На цьому етапі:

- production/Render повинен мати `DB_SYNCHRONIZE=false`; запуск із відсутнім значенням або `true` має бути заблокований до підключення TypeORM;
- старі migration-файли не реєструються і не запускаються;
- initial baseline row не вставляється в production migration history, а наявна runtime history не переписується вручну;
- production schema і production data guard-перевіркою не змінюються;
- `database/schema.sql` не використовується як джерело істини;
- fresh-only baseline не підключений до runtime.

## Наступні schema changes

Fresh bootstrap і existing-production history залишаються різними шляхами. Після production switch не потрібен окремий migration-history adoption для initial baseline.

Кожна наступна зміна database schema повинна бути новою TypeORM migration з безпечними `up`/`down` і пройти CI на обох history-шляхах перед production deploy.
