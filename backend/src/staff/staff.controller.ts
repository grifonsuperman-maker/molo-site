import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';

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
import type { StaffRole } from './entities/staff.entity';
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
      return this.recoverShiftState(id, true, cause, 'відкриття');
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
      return this.recoverShiftState(id, false, cause, 'закриття');
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

  private async recoverShiftState(
    id: string,
    expectedOnShift: boolean,
    cause: unknown,
    action: string,
  ) {
    try {
      const current = await this.service.findOne(id);
      if (current.isOnShift === expectedOnShift) {
        this.logger.error(
          `Помилка журналу після ${action} зміни для ${id}; фактичний стан збережено`,
          cause instanceof Error ? cause.stack : String(cause),
        );
        return current;
      }
    } catch (readError) {
      this.logger.error(
        `Не вдалося перевірити стан працівника ${id} після помилки зміни`,
        readError instanceof Error ? readError.stack : String(readError),
      );
    }

    throw cause;
  }

  private assertCannotRemoveSelf(user: AuthUser | undefined, targetId: string) {
    const currentId = user?.staffId || user?.sub;
    if (currentId && currentId === targetId) {
      throw new BadRequestException('Директор не може видалити власний обліковий запис');
    }
  }
}
