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

## Важливі обмеження

На цьому етапі:

- `synchronize: true` не вимикається;
- старі migration-файли не реєструються і не запускаються;
- production schema і production data не змінюються;
- `database/schema.sql` не використовується як джерело істини;
- жодних DDL/DML операцій цей baseline-процес не виконує.

Перед майбутнім переходом на `synchronize: false` потрібно окремо перевірити повний baseline на ізольованій копії production, підтвердити відсутність schema drift і лише після цього робити окремий PR для зміни runtime-конфігурації.
