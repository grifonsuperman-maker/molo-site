import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RestaurantService } from '../restaurant/restaurant.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { StaffPinLoginDto } from './dto/staff-pin-login.dto';
import { StaffShiftActionDto } from './dto/staff-shift-action.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(
    private readonly service: StaffService,
    private readonly restaurant: RestaurantService,
  ) {}

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
    @Req() request: any,
  ) {
    await this.assertCanManageShift(request);
    return this.service.startShift(id, dto);
  }

  @Roles('owner', 'admin')
  @Post(':id/shift/end')
  async endShift(
    @Param('id') id: string,
    @Body() dto: StaffShiftActionDto,
    @Req() request: any,
  ) {
    await this.assertCanManageShift(request);
    return this.service.endShift(id, dto);
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
  ) {
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
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  private async assertCanManageShift(request: any) {
    if (request.user?.role !== 'admin') return;
    await this.restaurant.assertAdminPermission(
      'adminCanManageStaffShifts',
      'Директор не надав право керувати змінами персоналу',
    );
  }
}
