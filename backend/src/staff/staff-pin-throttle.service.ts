import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

const PIN_MAX_FAILED_ATTEMPTS = 5;
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

type PinThrottleOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

type PersistedPinAttempt = {
  failed_attempts: number | string;
  window_started_at: Date | string;
  locked_until: Date | string | null;
};

@Injectable()
export class StaffPinThrottleService {
  constructor(private readonly dataSource: DataSource) {}

  async execute<T>(options: PinThrottleOptions<T>): Promise<T> {
    const subjectHash = createHash('sha256')
      .update(options.subject)
      .digest('hex');

    const outcome = await this.dataSource.transaction<PinThrottleOutcome<T>>(
      async (manager) => {
        await this.acquireSubjectLock(manager, options.scope, subjectHash);
        await this.cleanupStaleAttempts(manager);

        let state = await this.getState(manager, options.scope, subjectHash);
        const now = Date.now();

        if (state?.locked_until) {
          const lockedUntil = new Date(state.locked_until).getTime();

          if (lockedUntil > now) {
            const minutes = Math.max(
              1,
              Math.ceil((lockedUntil - now) / 60_000),
            );
            return {
              ok: false,
              error: new HttpException(
                `Забагато невдалих спроб. Повторіть через ${minutes} хв.`,
                429,
              ),
            };
          }

          await this.deleteState(manager, options.scope, subjectHash);
          state = null;
        }

        if (
          state &&
          now - new Date(state.window_started_at).getTime() >=
            PIN_ATTEMPT_WINDOW_MS
        ) {
          await this.deleteState(manager, options.scope, subjectHash);
          state = null;
        }

        try {
          const value = await options.action();
          await this.deleteState(manager, options.scope, subjectHash);
          return { ok: true, value };
        } catch (error) {
          if (
            options.resetOnErrorMessage &&
            this.hasHttpMessage(error, options.resetOnErrorMessage)
          ) {
            await this.deleteState(manager, options.scope, subjectHash);
            return { ok: false, error };
          }

          if (!this.hasHttpMessage(error, options.credentialFailureMessage)) {
            return { ok: false, error };
          }

          const failedAttempts = Number(state?.failed_attempts || 0) + 1;
          const windowStartedAt = state
            ? new Date(state.window_started_at)
            : new Date(now);
          const shouldLock = failedAttempts >= PIN_MAX_FAILED_ATTEMPTS;
          const lockedUntil = shouldLock ? new Date(now + PIN_LOCK_MS) : null;

          await this.saveState(manager, {
            scope: options.scope,
            subjectHash,
            failedAttempts,
            windowStartedAt,
            lockedUntil,
          });

          if (shouldLock) {
            return {
              ok: false,
              error: new HttpException(
                'Забагато невдалих спроб. Вхід заблоковано на 15 хв.',
                429,
              ),
            };
          }

          return { ok: false, error };
        }
      },
    );

    if (!outcome.ok) {
      throw outcome.error;
    }

    return outcome.value;
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

  private async cleanupStaleAttempts(manager: EntityManager) {
    await manager.query(
      `DELETE FROM "staff_pin_attempts"
       WHERE "updated_at" < NOW() - INTERVAL '${STALE_ATTEMPT_RETENTION_HOURS} hours'
         AND ("locked_until" IS NULL OR "locked_until" <= NOW())`,
    );
  }

  private async getState(
    manager: EntityManager,
    scope: PinThrottleScope,
    subjectHash: string,
  ): Promise<PersistedPinAttempt | null> {
    const rows = (await manager.query(
      `SELECT "failed_attempts", "window_started_at", "locked_until"
       FROM "staff_pin_attempts"
       WHERE "scope" = $1 AND "subject_hash" = $2
       FOR UPDATE`,
      [scope, subjectHash],
    )) as PersistedPinAttempt[];

    return rows[0] || null;
  }

  private async saveState(
    manager: EntityManager,
    input: {
      scope: PinThrottleScope;
      subjectHash: string;
      failedAttempts: number;
      windowStartedAt: Date;
      lockedUntil: Date | null;
    },
  ) {
    await manager.query(
      `INSERT INTO "staff_pin_attempts" (
         "scope",
         "subject_hash",
         "failed_attempts",
         "window_started_at",
         "locked_until",
         "updated_at"
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT ("scope", "subject_hash") DO UPDATE SET
         "failed_attempts" = EXCLUDED."failed_attempts",
         "window_started_at" = EXCLUDED."window_started_at",
         "locked_until" = EXCLUDED."locked_until",
         "updated_at" = NOW()`,
      [
        input.scope,
        input.subjectHash,
        input.failedAttempts,
        input.windowStartedAt,
        input.lockedUntil,
      ],
    );
  }

  private async deleteState(
    manager: EntityManager,
    scope: PinThrottleScope,
    subjectHash: string,
  ) {
    await manager.query(
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
