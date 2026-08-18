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

Runtime-перемикач `DB_SYNCHRONIZE` дозволяє окремо перевірити backend на ізольованій копії production:

- якщо `DB_SYNCHRONIZE` не задано, поточна поведінка зберігається: `synchronize: true`;
- `DB_SYNCHRONIZE=false` вимикає TypeORM schema synchronize;
- `DB_SYNCHRONIZE=true` вмикає його явно;
- будь-яке інше непорожнє значення зупиняє запуск із зрозумілою помилкою замість неоднозначного режиму.

`DB_SYNCHRONIZE=false` на цьому етапі потрібно використовувати **лише** для тимчасового backend, підключеного до ізольованої Neon branch. Production environment поки не змінюється.

## Важливі обмеження

На цьому етапі:

- production продовжує працювати з поточною поведінкою `synchronize: true`, доки `DB_SYNCHRONIZE` там не задано;
- старі migration-файли не реєструються і не запускаються;
- production schema і production data не змінюються;
- `database/schema.sql` не використовується як джерело істини;
- жодних DDL/DML операцій baseline-процес не виконує.

Перед майбутнім переходом production на `synchronize: false` потрібно окремо запустити backend з `DB_SYNCHRONIZE=false` проти ізольованої копії production, підтвердити запуск і відсутність schema drift, і лише після цього робити окремий PR для зміни production runtime-конфігурації.
