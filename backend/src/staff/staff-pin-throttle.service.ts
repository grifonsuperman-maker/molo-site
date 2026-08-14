import { HttpException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

const PIN_MAX_FAILED_ATTEMPTS = 5;
const PIN_FAILED_WINDOW_MS = 15 * 60 * 1000;
const PIN_LOCK_MS = 15 * 60 * 1000;
const PIN_PENDING_TTL_MS = 60 * 1000;

type PinThrottleScope = 'pin-login' | 'telegram-link';

type PinThrottleOptions<T> = {
  scope: PinThrottleScope;
  subject: string;
  action: () => Promise<T>;
  credentialFailureMessage: string;
  resetOnErrorMessage?: string;
};

type AttemptReservation = {
  id: string | number;
};

@Injectable()
export class StaffPinThrottleService {
  private readonly logger = new Logger(StaffPinThrottleService.name);

  constructor(private readonly dataSource: DataSource) {}

  async execute<T>(options: PinThrottleOptions<T>): Promise<T> {
    const subjectHash = createHash('sha256')
      .update(options.subject)
      .digest('hex');

    await this.cleanupStaleAttempts();
    const reservation = await this.reserveAttempt(options.scope, subjectHash);

    let value: T;
    try {
      value = await options.action();
    } catch (error) {
      if (
        options.resetOnErrorMessage &&
        this.hasHttpMessage(error, options.resetOnErrorMessage)
      ) {
        await this.bestEffortCleanup(
          () => this.clearThrough(options.scope, subjectHash, reservation.id),
          'reset_after_verified_credential',
        );
        throw error;
      }

      if (this.hasHttpMessage(error, options.credentialFailureMessage)) {
        const locked = await this.markCredentialFailure(
          options.scope,
          subjectHash,
          reservation.id,
        );
        if (locked) {
          throw new HttpException(
            'Забагато невдалих спроб. Вхід заблоковано на 15 хв.',
            429,
          );
        }
        throw error;
      }

      await this.bestEffortCleanup(
        () => this.releaseReservation(options.scope, subjectHash, reservation.id),
        'release_non_credential_failure',
      );
      throw error;
    }

    await this.bestEffortCleanup(
      () => this.clearThrough(options.scope, subjectHash, reservation.id),
      'clear_after_success',
    );
    return value;
  }

  private async reserveAttempt(
    scope: PinThrottleScope,
    subjectHash: string,
  ): Promise<AttemptReservation> {
    return this.dataSource.transaction(async (manager) => {
      await this.acquireSubjectLock(manager, scope, subjectHash);

      const activeLock = await this.findActiveLock(manager, scope, subjectHash);
      if (activeLock) {
        this.throwActiveLock(activeLock);
      }

      const countRows = (await manager.query(
        `SELECT COUNT(*)::int AS "count"
         FROM "staff_pin_attempts"
         WHERE "scope" = $1 AND "subject_hash" = $2`,
        [scope, subjectHash],
      )) as Array<{ count: number | string }>;

      if (Number(countRows[0]?.count || 0) >= PIN_MAX_FAILED_ATTEMPTS) {
        throw new HttpException(
          'Забагато одночасних спроб. Повторіть через 1 хв.',
          429,
        );
      }

      const rows = (await manager.query(
        `INSERT INTO "staff_pin_attempts" (
           "scope",
           "subject_hash",
           "status",
           "reserved_at",
           "updated_at"
         ) VALUES ($1, $2, 'pending', NOW(), NOW())
         RETURNING "id"`,
        [scope, subjectHash],
      )) as AttemptReservation[];

      if (!rows[0]) {
        throw new HttpException(
          'Не вдалося перевірити PIN. Спробуйте ще раз.',
          503,
        );
      }

      return rows[0];
    });
  }

  private async markCredentialFailure(
    scope: PinThrottleScope,
    subjectHash: string,
    reservationId: string | number,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      await this.acquireSubjectLock(manager, scope, subjectHash);

      const updatedRows = (await manager.query(
        `UPDATE "staff_pin_attempts"
         SET "status" = 'failed',
             "failed_at" = NOW(),
             "updated_at" = NOW()
         WHERE "id" = $3
           AND "scope" = $1
           AND "subject_hash" = $2
           AND "status" = 'pending'
         RETURNING "id"`,
        [scope, subjectHash, reservationId],
      )) as AttemptReservation[];

      if (!updatedRows[0]) {
        return false;
      }

      const failedRows = (await manager.query(
        `SELECT COUNT(*)::int AS "count"
         FROM "staff_pin_attempts"
         WHERE "scope" = $1
           AND "subject_hash" = $2
           AND "status" = 'failed'
           AND "failed_at" >= NOW() - ($3::bigint * INTERVAL '1 millisecond')`,
        [scope, subjectHash, PIN_FAILED_WINDOW_MS],
      )) as Array<{ count: number | string }>;

      if (Number(failedRows[0]?.count || 0) < PIN_MAX_FAILED_ATTEMPTS) {
        return false;
      }

      await manager.query(
        `UPDATE "staff_pin_attempts"
         SET "locked_until" = NOW() + ($4::bigint * INTERVAL '1 millisecond'),
             "updated_at" = NOW()
         WHERE "id" = $3
           AND "scope" = $1
           AND "subject_hash" = $2`,
        [scope, subjectHash, reservationId, PIN_LOCK_MS],
      );

      return true;
    });
  }

  private async acquireSubjectLock(
    manager: EntityManager,
    scope: PinThrottleScope,
    subjectHash: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [scope, subjectHash],
    );
  }

  private async findActiveLock(
    manager: EntityManager,
    scope: PinThrottleScope,
    subjectHash: string,
  ) {
    const rows = (await manager.query(
      `SELECT "locked_until"
       FROM "staff_pin_attempts"
       WHERE "scope" = $1
         AND "subject_hash" = $2
         AND "locked_until" > NOW()
       ORDER BY "locked_until" DESC
       LIMIT 1`,
      [scope, subjectHash],
    )) as Array<{ locked_until: Date | string }>;

    return rows[0]?.locked_until || null;
  }

  private throwActiveLock(lockedUntilValue: Date | string): never {
    const lockedUntil = new Date(lockedUntilValue).getTime();
    const minutes = Math.max(
      1,
      Math.ceil((lockedUntil - Date.now()) / 60_000),
    );
    throw new HttpException(
      `Забагато невдалих спроб. Повторіть через ${minutes} хв.`,
      429,
    );
  }

  private async clearThrough(
    scope: PinThrottleScope,
    subjectHash: string,
    reservationId: string | number,
  ) {
    await this.dataSource.query(
      `DELETE FROM "staff_pin_attempts"
       WHERE "scope" = $1
         AND "subject_hash" = $2
         AND "id" <= $3
         AND ("status" = 'failed' OR "id" = $3)`,
      [scope, subjectHash, reservationId],
    );
  }

  private async releaseReservation(
    scope: PinThrottleScope,
    subjectHash: string,
    reservationId: string | number,
  ) {
    await this.dataSource.query(
      `DELETE FROM "staff_pin_attempts"
       WHERE "scope" = $1
         AND "subject_hash" = $2
         AND "id" = $3
         AND "status" = 'pending'`,
      [scope, subjectHash, reservationId],
    );
  }

  private async cleanupStaleAttempts() {
    await this.dataSource.query(
      `DELETE FROM "staff_pin_attempts"
       WHERE ("locked_until" IS NULL OR "locked_until" <= NOW())
         AND (
           ("status" = 'pending'
             AND "reserved_at" <= NOW() - ($1::bigint * INTERVAL '1 millisecond'))
           OR
           ("status" = 'failed'
             AND "failed_at" IS NOT NULL
             AND "failed_at" <= NOW() - ($2::bigint * INTERVAL '1 millisecond'))
         )`,
      [PIN_PENDING_TTL_MS, PIN_FAILED_WINDOW_MS],
    );
  }

  private async bestEffortCleanup(
    action: () => Promise<unknown>,
    stage: string,
  ) {
    try {
      await action();
    } catch (error) {
      this.logger.error(
        `PIN throttle cleanup failed at ${stage}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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
