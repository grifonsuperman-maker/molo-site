import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  InternalServerErrorException,
  Logger,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { DirectorLoginDto } from './dto/director-login.dto';
import { StaffPinLoginDto } from './dto/staff-pin-login.dto';
import { StaffShiftActionDto } from './dto/staff-shift-action.dto';
import { UpdateDirectorAccessDto } from './dto/update-director-access.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  private readonly logger = new Logger(StaffController.name);

  constructor(
    private readonly service: StaffService,
    private readonly permissions: AdminPermissionsService,
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
  loginWithPin(@Body() dto: StaffPinLoginDto) {
    return this.service.loginWithPin(dto);
  }

  @Roles('owner', 'admin')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles('owner')
  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.service.create(dto);
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

  @Roles('owner')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
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

  @Roles('owner')
  @Patch(':id/block')
  block(@Param('id') id: string) {
    return this.service.setActive(id, false);
  }

  @Roles('owner')
  @Patch(':id/unblock')
  unblock(@Param('id') id: string) {
    return this.service.setActive(id, true);
  }

  @Roles('owner')
  @Post(':id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
    @Req() request: { user?: AuthUser },
  ) {
    this.assertCannotRemoveSelf(request.user, id);
    return this.service.archive(id, dto);
  }

  @Roles('owner')
  @Post(':id/restore')
  restore(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
  ) {
    return this.service.restore(id, dto);
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
