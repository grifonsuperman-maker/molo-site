import { Body, Controller, Get, Header, Patch, Post, Req } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ConnectSyrveDto,
  DisconnectSyrveDto,
  SyrveRevisionDto,
  PreviewSyrveTablesDto,
  TestSyrveConnectionDto,
  UpdateSyrveConnectionDto,
} from './dto/syrve-integration.dto';
import { SyrveIntegrationService } from './syrve-integration.service';
import { SyrveReadinessService } from './syrve-readiness.service';

@Roles('owner')
@Controller('syrve-integration')
export class SyrveIntegrationController {
  constructor(private readonly service: SyrveIntegrationService, private readonly readiness: SyrveReadinessService) {}

  @Get('readiness')
  @Header('Cache-Control', 'no-store')
  getReadiness() { return this.readiness.read(); }

  @Get()
  @Header('Cache-Control', 'no-store')
  getStatus() {
    return this.service.getStatus();
  }

  @Post('test')
  test(@Body() dto: TestSyrveConnectionDto) {
    return this.service.test(dto);
  }

  @Post('connect')
  connect(
    @Body() dto: ConnectSyrveDto,
    @Req() request: { user?: AuthUser },
  ) {
    return this.service.connect(dto, request.user);
  }

  @Post('tables-preview')
  @Header('Cache-Control', 'no-store')
  previewTables(@Body() dto: PreviewSyrveTablesDto) {
    return this.service.previewTables(dto);
  }

  @Post('orders-observation')
  @Header('Cache-Control', 'no-store')
  observeOrders(@Body() dto: SyrveRevisionDto) {
    return this.service.observeOrders(dto);
  }

  @Post('orders-diagnostics')
  @Header('Cache-Control', 'no-store')
  orderDiagnostics(@Body() dto: SyrveRevisionDto) {
    return this.service.orderDiagnostics(dto);
  }

  @Post('recheck')
  recheck(@Body() dto: SyrveRevisionDto, @Req() request: { user?: AuthUser }) {
    return this.service.recheck(dto, request.user);
  }

  @Patch()
  updateMetadata(@Body() dto: UpdateSyrveConnectionDto) {
    return this.service.updateMetadata(dto);
  }

  @Post('disconnect')
  disconnect(
    @Body() body: DisconnectSyrveDto,
    @Req() request: { user?: AuthUser },
  ) {
    return this.service.disconnect(body, request.user);
  }
}
