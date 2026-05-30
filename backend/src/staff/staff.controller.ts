import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('owner', 'admin')
@Controller('staff')
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/block')
  block(@Param('id') id: string) {
    return this.service.setActive(id, false);
  }

  @Patch(':id/unblock')
  unblock(@Param('id') id: string) {
    return this.service.setActive(id, true);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
