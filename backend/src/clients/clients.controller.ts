import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import { LogsService } from '../logs/logs.service';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { ClientsService } from './clients.service';
import { ChangeBlacklistDto } from './dto/change-blacklist.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Roles('owner', 'admin')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly service: ClientsService,
    private readonly permissions: AdminPermissionsService,
    private readonly logs: LogsService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles('owner')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/blacklist')
  async blacklist(
    @Param('id') id: string,
    @Body() dto: ChangeBlacklistDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanManageBlacklist');
    const client = await this.service.blacklist(id, dto.reason);
    await this.logs.create('Гостя додано до чорного списку', null, {
      clientId: client.id,
      clientName: client.fullName,
      reason: dto.reason.trim(),
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return client;
  }

  @Patch(':id/unblacklist')
  async unblacklist(
    @Param('id') id: string,
    @Body() dto: ChangeBlacklistDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanManageBlacklist');
    const client = await this.service.unblacklist(id);
    await this.logs.create('Гостя розблоковано', null, {
      clientId: client.id,
      clientName: client.fullName,
      reason: dto.reason.trim(),
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return client;
  }
}
