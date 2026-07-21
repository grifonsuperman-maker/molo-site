import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { WaiterCallsService } from './waiter-calls.service';

@Controller('waiter-calls')
export class WaiterCallsController {
  constructor(private readonly service: WaiterCallsService) {}

  @Post()
  @Public()
  createFromGuest(@Body() dto: { bookingId: string }) {
    return this.service.createFromGuest(dto);
  }

  @Get()
  @Roles('waiter', 'admin', 'owner')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.role === 'waiter' ? user.staffId || undefined : undefined);
  }

  @Get('guest-status/:bookingId')
  @Public()
  guestStatus(@Param('bookingId') bookingId: string) {
    return this.service.guestStatus(bookingId);
  }

  @Get('assignments')
  @Roles('waiter', 'admin', 'owner')
  assignments(@CurrentUser() user: AuthUser) {
    return this.service.myAssignments(user.staffId || '');
  }

  @Post('assign')
  @Roles('waiter')
  assign(@Body() dto: {
    bookingId: string;
    tableId?: string | null;
    tableNumber?: string | null;
    waiterId: string;
    waiterName: string;
  }, @CurrentUser() user: AuthUser) {
    return this.service.assign({ ...dto, waiterId: user.staffId || '', waiterName: user.name || 'Офіціант' });
  }

  @Patch(':id/accept')
  @Roles('waiter')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.accept(id, { waiterId: user.staffId || '', waiterName: user.name || 'Офіціант' });
  }

  @Patch(':id/close')
  @Roles('waiter')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }
}
