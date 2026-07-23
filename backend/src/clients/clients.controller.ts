import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator';
import { RestaurantService } from '../restaurant/restaurant.service';
import { ClientsService } from './clients.service';
import { ChangeBlacklistDto } from './dto/change-blacklist.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Roles('owner', 'admin')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly service: ClientsService,
    private readonly restaurant: RestaurantService,
  ) {}

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
  async blacklist(
    @Param('id') id: string,
    @Body() dto: ChangeBlacklistDto,
    @Req() request: any,
  ) {
    if (request.user?.role === 'admin') {
      await this.restaurant.assertAdminPermission(
        'adminCanManageBlacklist',
        'Директор не надав право керувати чорним списком',
      );
    }
    return this.service.blacklist(id, dto.reason, request.user);
  }

  @Patch(':id/unblacklist')
  async unblacklist(
    @Param('id') id: string,
    @Body() dto: ChangeBlacklistDto,
    @Req() request: any,
  ) {
    if (request.user?.role === 'admin') {
      await this.restaurant.assertAdminPermission(
        'adminCanManageBlacklist',
        'Директор не надав право керувати чорним списком',
      );
    }
    return this.service.unblacklist(id, dto.reason, request.user);
  }
}
