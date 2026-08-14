import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';

const PIN_MAX_ATTEMPTS = 5;
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PIN_LOCK_MS = 15 * 60 * 1000;
const STALE_ATTEMPT_RETENTION_HOURS = 24;

type PinThrottleScope = 'pin-login' | 'telegram-link';

type PinThrottleOptions<T> = {
  scope: PinThrottleScope;
  subject: string;
  action: () => Promise<T>;
  credentialFailureMessage: string;
  resetOnErrorMessage?: string;
};

type ReservedAttempt = {
  attempt_count: number | string;
  locked_until: Date | string | null;
};

@Injectable()
export class StaffPinThrottleService {
  constructor(private readonly dataSource: DataSource) {}

  async execute<T>(options: PinThrottleOptions<T>): Promise<T> {
    const subjectHash = createHash('sha256')
      .update(options.subject)
      .digest('hex');

    await this.cleanupStaleAttempts();
    const reservation = await this.reserveAttempt(options.scope, subjectHash);

    try {
      const value = await options.action();
      await this.deleteState(options.scope, subjectHash);
      return value;
    } catch (error) {
      if (
        options.resetOnErrorMessage &&
        this.hasHttpMessage(error, options.resetOnErrorMessage)
      ) {
        await this.deleteState(options.scope, subjectHash);
        throw error;
      }

      if (this.hasHttpMessage(error, options.credentialFailureMessage)) {
        if (
          Number(reservation.attempt_count) >= PIN_MAX_ATTEMPTS &&
          reservation.locked_until
        ) {
          throw new HttpException(
            'Забагато невдалих спроб. Вхід заблоковано на 15 хв.',
            429,
          );
        }
        throw error;
      }

      await this.releaseReservation(options.scope, subjectHash);
      throw error;
    }
  }

  private async reserveAttempt(
    scope: PinThrottleScope,
    subjectHash: string,
  ): Promise<ReservedAttempt> {
    for (let retry = 0; retry < 2; retry += 1) {
      const rows = (await this.dataSource.query(
        `INSERT INTO "staff_pin_attempts" (
           "scope",
           "subject_hash",
           "attempt_count",
           "window_started_at",
           "locked_until",
           "updated_at"
         ) VALUES ($1, $2, 1, NOW(), NULL, NOW())
         ON CONFLICT ("scope", "subject_hash") DO UPDATE SET
           "attempt_count" = CASE
             WHEN "staff_pin_attempts"."window_started_at" <= NOW() - ($3::bigint * INTERVAL '1 millisecond')
               OR ("staff_pin_attempts"."locked_until" IS NOT NULL AND "staff_pin_attempts"."locked_until" <= NOW())
             THEN 1
             ELSE "staff_pin_attempts"."attempt_count" + 1
           END,
           "window_started_at" = CASE
             WHEN "staff_pin_attempts"."window_started_at" <= NOW() - ($3::bigint * INTERVAL '1 millisecond')
               OR ("staff_pin_attempts"."locked_until" IS NOT NULL AND "staff_pin_attempts"."locked_until" <= NOW())
             THEN NOW()
             ELSE "staff_pin_attempts"."window_started_at"
           END,
           "locked_until" = CASE
             WHEN "staff_pin_attempts"."window_started_at" <= NOW() - ($3::bigint * INTERVAL '1 millisecond')
               OR ("staff_pin_attempts"."locked_until" IS NOT NULL AND "staff_pin_attempts"."locked_until" <= NOW())
             THEN NULL
             WHEN "staff_pin_attempts"."attempt_count" + 1 >= $4
             THEN NOW() + ($5::bigint * INTERVAL '1 millisecond')
             ELSE NULL
           END,
           "updated_at" = NOW()
         WHERE "staff_pin_attempts"."locked_until" IS NULL
            OR "staff_pin_attempts"."locked_until" <= NOW()
         RETURNING "attempt_count", "locked_until"`,
        [
          scope,
          subjectHash,
          PIN_ATTEMPT_WINDOW_MS,
          PIN_MAX_ATTEMPTS,
          PIN_LOCK_MS,
        ],
      )) as ReservedAttempt[];

      if (rows[0]) {
        return rows[0];
      }

      const lockedRows = (await this.dataSource.query(
        `SELECT "locked_until"
         FROM "staff_pin_attempts"
         WHERE "scope" = $1 AND "subject_hash" = $2`,
        [scope, subjectHash],
      )) as Array<{ locked_until: Date | string | null }>;
      const lockedUntil = lockedRows[0]?.locked_until
        ? new Date(lockedRows[0].locked_until).getTime()
        : 0;

      if (lockedUntil > Date.now()) {
        const minutes = Math.max(
          1,
          Math.ceil((lockedUntil - Date.now()) / 60_000),
        );
        throw new HttpException(
          `Забагато невдалих спроб. Повторіть через ${minutes} хв.`,
          429,
        );
      }
    }

    throw new HttpException(
      'Забагато невдалих спроб. Повторіть через 1 хв.',
      429,
    );
  }

  private async releaseReservation(
    scope: PinThrottleScope,
    subjectHash: string,
  ) {
    const rows = (await this.dataSource.query(
      `UPDATE "staff_pin_attempts"
       SET "attempt_count" = GREATEST("attempt_count" - 1, 0),
           "locked_until" = CASE
             WHEN GREATEST("attempt_count" - 1, 0) < $3 THEN NULL
             ELSE "locked_until"
           END,
           "updated_at" = NOW()
       WHERE "scope" = $1 AND "subject_hash" = $2
       RETURNING "attempt_count"`,
      [scope, subjectHash, PIN_MAX_ATTEMPTS],
    )) as Array<{ attempt_count: number | string }>;

    if (Number(rows[0]?.attempt_count ?? 1) === 0) {
      await this.deleteState(scope, subjectHash);
    }
  }

  private async cleanupStaleAttempts() {
    await this.dataSource.query(
      `DELETE FROM "staff_pin_attempts"
       WHERE "updated_at" < NOW() - INTERVAL '${STALE_ATTEMPT_RETENTION_HOURS} hours'
         AND ("locked_until" IS NULL OR "locked_until" <= NOW())`,
    );
  }

  private async deleteState(scope: PinThrottleScope, subjectHash: string) {
    await this.dataSource.query(
      `DELETE FROM "staff_pin_attempts"
       WHERE "scope" = $1 AND "subject_hash" = $2`,
      [scope, subjectHash],
    );
  }

  private hasHttpMessage(error: unknown, expectedMessage: string) {
    if (!(error instanceof HttpException)) {
      return false;
    }

    const response = error.getResponse() as any;
    const message =
      typeof response === 'string'
        ? response
        : Array.isArray(response?.message)
          ? response.message.join(' ')
          : response?.message;

    return message === expectedMessage;
  }
}
