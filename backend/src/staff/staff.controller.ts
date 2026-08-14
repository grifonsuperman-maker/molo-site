import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  InternalServerErrorException,
  Logger,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { DirectorLoginDto } from './dto/director-login.dto';
import { StaffPinLoginDto } from './dto/staff-pin-login.dto';
import { StaffShiftActionDto } from './dto/staff-shift-action.dto';
import {
  ConfirmTelegramStaffLinkDto,
  TelegramStaffLinkTokenDto,
} from './dto/telegram-staff-link.dto';
import { UpdateDirectorAccessDto } from './dto/update-director-access.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import type { StaffRole } from './entities/staff.entity';
import { StaffService } from './staff.service';
import { TelegramStaffLinkService } from './telegram-staff-link.service';

const PIN_MAX_FAILED_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_LOCK_MS = 15 * 60 * 1000;
const PIN_ATTEMPT_MAX_ENTRIES = 10_000;
const PIN_OVERFLOW_BUCKET_COUNT = 256;
const TELEGRAM_INVITE_PREFIX = 'staff_';

type PinAttemptState = {
  failedAttempts: number;
  windowStartedAt: number;
  lockedUntil: number | null;
};

type PinAttemptTracking = {
  key: string;
  attempts: Map<string, PinAttemptState>;
  shared: boolean;
};

@Controller('staff')
export class StaffController {
  private readonly logger = new Logger(StaffController.name);
  private readonly pinAttempts = new Map<string, PinAttemptState>();
  private readonly pinOverflowAttempts = new Map<string, PinAttemptState>();
  private readonly pinAttemptQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly service: StaffService,
    private readonly permissions: AdminPermissionsService,
    private readonly telegramLinks: TelegramStaffLinkService,
  ) {}

  @Public()
  @Get('director-access/status')
  getDirectorAccessStatus() {
    return this.service.getDirectorAccessStatus();
  }

  @Public()
  @Post('director-access/login')
  loginDirector(@Body() dto: DirectorLoginDto) {
    return this.service.loginDirector(dto);
  }

  @Roles('owner')
  @Get('director-access')
  getDirectorAccess(@Req() request: { user?: AuthUser }) {
    return this.service.getDirectorAccess(request.user);
  }

  @Roles('owner')
  @Patch('director-access')
  updateDirectorAccess(
    @Req() request: { user?: AuthUser },
    @Body() dto: UpdateDirectorAccessDto,
  ) {
    return this.service.updateDirectorAccess(request.user, dto);
  }

  @Public()
  @Get('login-options')
  findActiveForLogin() {
    return this.service.findActiveForLogin();
  }

  @Public()
  @Post('pin-login')
  async loginWithPin(@Body() dto: StaffPinLoginDto) {
    const primaryKey = this.pinAttemptKey(
      'pin-login',
      dto.staffId.toLowerCase(),
    );
    const tracking = this.selectPinAttemptTracking(primaryKey);

    return this.withPinAttemptLock(tracking.key, async () => {
      this.assertPinAttemptAllowed(tracking.key, tracking.attempts);

      try {
        const result = await this.service.loginWithPin(dto);
        if (!tracking.shared) {
          this.resetPinAttempts(tracking.key, tracking.attempts);
        }
        return result;
      } catch (error) {
        if (this.isCredentialFailure(error, 'Невірний працівник або PIN')) {
          this.registerPinFailure(tracking.key, tracking.attempts);
        } else if (!tracking.shared) {
          this.resetPinAttempts(tracking.key, tracking.attempts);
        }
        throw error;
      }
    });
  }

  @Public()
  @Post('telegram-link/info')
  getTelegramLinkInfo(@Body() dto: TelegramStaffLinkTokenDto) {
    return this.telegramLinks.getInviteInfo(dto.token);
  }

  @Public()
  @Post('telegram-link/confirm')
  async confirmTelegramLink(@Body() dto: ConfirmTelegramStaffLinkDto) {
    const normalizedToken = this.normalizeTelegramInviteToken(dto.token);
    const tokenFingerprint = createHash('sha256')
      .update(normalizedToken)
      .digest('hex');
    const primaryKey = this.pinAttemptKey('telegram-link', tokenFingerprint);
    const tracking = this.selectPinAttemptTracking(primaryKey);

    return this.withPinAttemptLock(tracking.key, async () => {
      this.assertPinAttemptAllowed(tracking.key, tracking.attempts);

      try {
        const result = await this.telegramLinks.confirmInvite(dto);
        if (!tracking.shared) {
          this.resetPinAttempts(tracking.key, tracking.attempts);
        }
        return result;
      } catch (error) {
        if (this.isCredentialFailure(error, 'Невірний PIN')) {
          this.registerPinFailure(tracking.key, tracking.attempts);
        } else if (!tracking.shared) {
          this.resetPinAttempts(tracking.key, tracking.attempts);
        }
        throw error;
      }
    });
  }

  @Roles('owner', 'admin')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles('owner', 'admin')
  @Post()
  async create(
    @Body() dto: CreateStaffDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.assertAdminCanCreateOrdinaryStaff(request.user, dto.role);
    return this.service.create(dto);
  }

  @Roles('owner', 'admin')
  @Post(':id/telegram-invite')
  async createTelegramInvite(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    await this.assertAdminCanManageOrdinaryStaff(request.user, id);
    return this.telegramLinks.createInvite(id);
  }

  @Roles('owner', 'admin')
  @Get(':id/history')
  getShiftHistory(@Param('id') id: string) {
    return this.service.getShiftHistory(id);
  }

  @Roles('owner', 'admin')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.assertAdminCanManageOrdinaryStaff(request.user, id, dto.role);
    return this.service.update(id, dto);
  }

  @Roles('owner', 'admin')
  @Post(':id/shift/start')
  async startShift(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanManageStaffShifts');

    try {
      return await this.service.startShift(id, dto);
    } catch (cause) {
      return this.recoverShiftState(
        id,
        true,
        cause,
        'start_shift',
        'відкрити',
      );
    }
  }

  @Roles('owner', 'admin')
  @Post(':id/shift/end')
  async endShift(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanManageStaffShifts');

    try {
      return await this.service.endShift(id, dto);
    } catch (cause) {
      return this.recoverShiftState(
        id,
        false,
        cause,
        'end_shift',
        'закрити',
      );
    }
  }

  @Roles('owner', 'admin')
  @Patch(':id/block')
  async block(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    await this.assertAdminCanManageOrdinaryStaff(request.user, id);
    return this.service.setActive(id, false);
  }

  @Roles('owner', 'admin')
  @Patch(':id/unblock')
  async unblock(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    await this.assertAdminCanManageOrdinaryStaff(request.user, id);
    return this.service.setActive(id, true);
  }

  @Roles('owner', 'admin')
  @Post(':id/archive')
  async archive(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
    @Req() request: { user?: AuthUser },
  ) {
    this.assertCannotRemoveSelf(request.user, id);
    await this.assertAdminCanManageOrdinaryStaff(request.user, id);
    return this.service.archive(id, dto);
  }

  @Roles('owner', 'admin')
  @Post(':id/restore')
  async restore(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.assertAdminCanManageOrdinaryStaff(request.user, id);
    return this.service.restore(id, dto);
  }

  @Roles('owner')
  @Delete(':id/permanent')
  deletePermanently(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    this.assertCannotRemoveSelf(request.user, id);
    return this.service.deletePermanently(id);
  }

  @Roles('owner')
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    this.assertCannotRemoveSelf(request.user, id);
    return this.service.remove(id);
  }

  private async assertAdminCanCreateOrdinaryStaff(
    user: AuthUser | undefined,
    role: StaffRole,
  ) {
    if (user?.role !== 'admin') return;

    await this.permissions.assert(user, 'adminCanManageStaffShifts');
    this.assertOrdinaryStaffRole(role);
  }

  private async assertAdminCanManageOrdinaryStaff(
    user: AuthUser | undefined,
    targetId: string,
    requestedRole?: StaffRole,
  ) {
    if (user?.role !== 'admin') return;

    await this.permissions.assert(user, 'adminCanManageStaffShifts');
    const target = await this.service.findOne(targetId);
    this.assertOrdinaryStaffRole(target.role);

    if (requestedRole !== undefined) {
      this.assertOrdinaryStaffRole(requestedRole);
    }
  }

  private assertOrdinaryStaffRole(role: StaffRole) {
    if (role !== 'waiter' && role !== 'hookah') {
      throw new ForbiddenException(
        'Адміністратор може керувати лише офіціантами та кальянниками',
      );
    }
  }

  private pinAttemptKey(scope: string, subject: string) {
    return createHash('sha256')
      .update(`${scope}|${subject}`)
      .digest('hex');
  }

  private normalizeTelegramInviteToken(value: string) {
    const token = String(value || '').trim();
    return token.startsWith(TELEGRAM_INVITE_PREFIX)
      ? token.slice(TELEGRAM_INVITE_PREFIX.length)
      : token;
  }

  private async withPinAttemptLock<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.pinAttemptQueues.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.pinAttemptQueues.set(key, queued);

    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.pinAttemptQueues.get(key) === queued) {
        this.pinAttemptQueues.delete(key);
      }
    }
  }

  private selectPinAttemptTracking(primaryKey: string): PinAttemptTracking {
    if (this.pinAttempts.has(primaryKey)) {
      return {
        key: primaryKey,
        attempts: this.pinAttempts,
        shared: false,
      };
    }

    const now = Date.now();
    if (this.pinAttempts.size >= PIN_ATTEMPT_MAX_ENTRIES) {
      this.cleanupPinAttemptStore(this.pinAttempts, now);
    }

    if (this.pinAttempts.size >= PIN_ATTEMPT_MAX_ENTRIES) {
      for (const [candidateKey, state] of this.pinAttempts) {
        const hasActiveLock = Boolean(
          state.lockedUntil && state.lockedUntil > now,
        );
        if (!hasActiveLock) {
          this.pinAttempts.delete(candidateKey);
          break;
        }
      }
    }

    if (this.pinAttempts.size < PIN_ATTEMPT_MAX_ENTRIES) {
      this.pinAttempts.set(primaryKey, {
        failedAttempts: 0,
        windowStartedAt: now,
        lockedUntil: null,
      });
      return {
        key: primaryKey,
        attempts: this.pinAttempts,
        shared: false,
      };
    }

    const overflowKey = this.pinOverflowAttemptKey(primaryKey);
    return {
      key: overflowKey,
      attempts: this.pinOverflowAttempts,
      shared: true,
    };
  }

  private pinOverflowAttemptKey(primaryKey: string) {
    const bucket =
      parseInt(primaryKey.slice(0, 8), 16) % PIN_OVERFLOW_BUCKET_COUNT;
    return `overflow:${bucket}`;
  }

  private assertPinAttemptAllowed(
    key: string,
    attempts: Map<string, PinAttemptState>,
  ) {
    const state = attempts.get(key);
    if (!state) return;

    const now = Date.now();
    if (state.lockedUntil && state.lockedUntil > now) {
      const minutes = Math.max(
        1,
        Math.ceil((state.lockedUntil - now) / 60_000),
      );
      throw new HttpException(
        `Забагато невдалих спроб. Повторіть через ${minutes} хв.`,
        429,
      );
    }

    if (
      (state.lockedUntil && state.lockedUntil <= now) ||
      now - state.windowStartedAt >= PIN_WINDOW_MS
    ) {
      attempts.delete(key);
    }
  }

  private registerPinFailure(
    key: string,
    attempts: Map<string, PinAttemptState>,
  ) {
    const now = Date.now();
    let state = attempts.get(key);

    if (!state || now - state.windowStartedAt >= PIN_WINDOW_MS) {
      state = {
        failedAttempts: 0,
        windowStartedAt: now,
        lockedUntil: null,
      };
    }

    state.failedAttempts += 1;

    if (state.failedAttempts >= PIN_MAX_FAILED_ATTEMPTS) {
      state.lockedUntil = now + PIN_LOCK_MS;
      attempts.set(key, state);
      throw new HttpException(
        'Забагато невдалих спроб. Вхід заблоковано на 15 хв.',
        429,
      );
    }

    attempts.set(key, state);
  }

  private resetPinAttempts(
    key: string,
    attempts: Map<string, PinAttemptState>,
  ) {
    attempts.delete(key);
  }

  private cleanupPinAttemptStore(
    attempts: Map<string, PinAttemptState>,
    now = Date.now(),
  ) {
    for (const [key, state] of attempts) {
      const lockExpired = !state.lockedUntil || state.lockedUntil <= now;
      const windowExpired = now - state.windowStartedAt >= PIN_WINDOW_MS;
      if (lockExpired && windowExpired) {
        attempts.delete(key);
      }
    }
  }

  private isCredentialFailure(error: unknown, expectedMessage: string) {
    if (!(error instanceof HttpException) || error.getStatus() !== 401) {
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

  private async recoverShiftState(
    id: string,
    expectedOnShift: boolean,
    cause: unknown,
    stage: 'start_shift' | 'end_shift',
    actionLabel: 'відкрити' | 'закрити',
  ) {
    let actualOnShift: boolean | null = null;
    let stateReadError: unknown = null;

    try {
      const current = await this.service.findOne(id);
      actualOnShift = Boolean(current.isOnShift);

      if (actualOnShift === expectedOnShift) {
        this.logger.error(
          `Помилка після операції ${stage} для ${id}; фактичний стан збережено`,
          cause instanceof Error ? cause.stack : String(cause),
        );
        return current;
      }
    } catch (readError) {
      stateReadError = readError;
    }

    if (cause instanceof HttpException) throw cause;

    const diagnosticId = `SHIFT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const failure = this.describeFailure(cause);
    const stateReadFailure = stateReadError
      ? this.describeFailure(stateReadError)
      : null;

    this.logger.error(
      JSON.stringify({
        event: 'staff_shift_action_failed',
        diagnosticId,
        stage,
        staffId: id,
        expectedOnShift,
        actualOnShift,
        ...failure,
        stateReadFailure,
      }),
      failure.stack || stateReadFailure?.stack || undefined,
    );

    throw new InternalServerErrorException(
      `Не вдалося ${actionLabel} зміну. Код діагностики: ${diagnosticId}`,
    );
  }

  private describeFailure(error: unknown) {
    const value = error as any;
    const driver = value?.driverError || value?.cause || null;

    return {
      errorName: value?.name || 'UnknownError',
      errorMessage: value?.message || String(error),
      postgresCode: value?.code || driver?.code || null,
      postgresDetail: value?.detail || driver?.detail || null,
      postgresConstraint: value?.constraint || driver?.constraint || null,
      postgresTable: value?.table || driver?.table || null,
      postgresColumn: value?.column || driver?.column || null,
      query: value?.query || null,
      parameters: Array.isArray(value?.parameters) ? value.parameters : null,
      stack: value?.stack || null,
    };
  }

  private assertCannotRemoveSelf(user: AuthUser | undefined, targetId: string) {
    const currentId = user?.staffId || user?.sub;
    if (currentId && currentId === targetId) {
      throw new BadRequestException('Директор не може видалити власний обліковий запис');
    }
  }
}
