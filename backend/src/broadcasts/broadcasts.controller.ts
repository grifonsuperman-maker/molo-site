import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@Roles('owner', 'admin')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(
    private readonly service: BroadcastsService,
    private readonly permissions: AdminPermissionsService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  async create(
    @Body() dto: CreateBroadcastDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanSendBroadcasts');
    return this.service.create(dto);
  }

  @Post('send-now')
  async sendNow(
    @Body() dto: CreateBroadcastDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanSendBroadcasts');
    return this.service.sendNow(dto);
  }

  @Post(':id/send')
  async send(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanSendBroadcasts');
    return this.service.send(id);
  }
}
