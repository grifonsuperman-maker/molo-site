import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
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

  @Roles('owner', 'admin')
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.service.create(dto);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.service.update(id, dto);
  }

  @Roles('owner', 'admin', 'waiter')
  @Patch(':id/occupied')
  occupied(@Param('id') id: string) {
    return this.service.markOccupied(id);
  }

  @Roles('owner', 'admin', 'waiter')
  @Patch(':id/free')
  free(@Param('id') id: string) {
    return this.service.markFree(id);
  }

  @Roles('owner', 'admin')
  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
