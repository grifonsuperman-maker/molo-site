import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { BlacklistClientDto } from './dto/blacklist-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('owner', 'admin')
@Controller('clients')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/blacklist')
  blacklist(@Param('id') id: string, @Body() dto: BlacklistClientDto) {
    return this.service.blacklist(id, dto.reason);
  }

  @Patch(':id/unblacklist')
  unblacklist(@Param('id') id: string) {
    return this.service.unblacklist(id);
  }
}
