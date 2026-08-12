import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TableStatus } from './entities/table.entity';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tables')
export class TablesController {
  constructor(private readonly service: TablesService) {}

  @Public()
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles('owner')
  create(@Body() dto: CreateTableDto) {
    return this.service.create(dto);
  }

  @Patch('number/:tableNumber/status')
  @Roles('admin', 'owner')
  statusByNumber(@Param('tableNumber') tableNumber: string, @Body() body: { status: TableStatus }) {
    return this.service.setStatusByNumber(tableNumber, body.status);
  }

  @Patch(':id/waiter-status')
  @Roles('waiter', 'admin', 'owner')
  waiterStatus(
    @Param('id') id: string,
    @Body('status') status: 'occupied' | 'free',
  ) {
    return this.service.setWaiterStatus(id, status);
  }

  @Patch(':id')
  @Roles('owner')
  update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('admin', 'owner')
  status(@Param('id') id: string, @Body() body: { status: TableStatus }) {
    return this.service.setStatus(id, body.status);
  }

  @Patch(':id/occupied')
  @Roles('waiter', 'admin', 'owner')
  occupied(@Param('id') id: string) {
    return this.service.markOccupied(id);
  }

  @Patch(':id/cleaning')
  @Roles('waiter', 'admin', 'owner')
  cleaning(@Param('id') id: string) {
    return this.service.markCleaning(id);
  }

  @Patch(':id/free')
  @Roles('waiter', 'admin', 'owner')
  free(@Param('id') id: string) {
    return this.service.markFree(id);
  }

  @Patch(':id/open')
  @Roles('admin', 'owner')
  open(@Param('id') id: string) {
    return this.service.open(id);
  }

  @Patch(':id/close')
  @Roles('admin', 'owner')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Delete(':id')
  @Roles('owner')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
