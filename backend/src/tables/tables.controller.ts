import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TableStatus } from './entities/table.entity';
import { Public } from '../common/decorators/public.decorator';

@Controller('tables')
export class TablesController {
  constructor(private readonly service: TablesService) {}

  @Public()
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Public()
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.service.create(dto);
  }

  @Public()
  @Patch('number/:tableNumber/status')
  statusByNumber(@Param('tableNumber') tableNumber: string, @Body() body: { status: TableStatus }) {
    return this.service.setStatusByNumber(tableNumber, body.status);
  }

  @Public()
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.service.update(id, dto);
  }

  @Public()
  @Patch(':id/status')
  status(@Param('id') id: string, @Body() body: { status: TableStatus }) {
    return this.service.setStatus(id, body.status);
  }

  @Public()
  @Patch(':id/occupied')
  occupied(@Param('id') id: string) {
    return this.service.markOccupied(id);
  }

  @Public()
  @Patch(':id/cleaning')
  cleaning(@Param('id') id: string) {
    return this.service.markCleaning(id);
  }

  @Public()
  @Patch(':id/free')
  free(@Param('id') id: string) {
    return this.service.markFree(id);
  }

  @Public()
  @Patch(':id/open')
  open(@Param('id') id: string) {
    return this.service.open(id);
  }

  @Public()
  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Public()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
