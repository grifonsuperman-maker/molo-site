import { Body, Controller, Get, Header, Param, Patch, Post, Req, UseInterceptors } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ConnectSyrveDto,
  ConfirmSyrveTableLoadingDto,
  EnableSyrveAutoStatusDto,
  DisconnectSyrveDto,
  SyrveRevisionDto,
  SyrveBillDiagnosticsDto,
  PreviewSyrveTablesDto,
  TestSyrveConnectionDto,
  UpdateSyrveConnectionDto,
} from './dto/syrve-integration.dto';
import { SyrveIntegrationService } from './syrve-integration.service';
import { SyrveReadinessService } from './syrve-readiness.service';
import { SyrveTableLoadingService } from './syrve-table-loading.service';
import { SyrveActivationService } from './syrve-activation.service';
import { SyrveAsync, SyrveAsyncInterceptor } from './syrve-async.interceptor';
import { SyrveOperationsService } from './syrve-operations.service';

@Roles('owner')
@UseInterceptors(SyrveAsyncInterceptor)
@Controller('syrve-integration')
export class SyrveIntegrationController {
  constructor(private readonly service: SyrveIntegrationService, private readonly readiness: SyrveReadinessService,
    private readonly loading: SyrveTableLoadingService, private readonly activation: SyrveActivationService,
    private readonly operations: SyrveOperationsService) {}

  @Get('operations/:id')
  @Header('Cache-Control', 'no-store')
  operation(@Param('id') id: string, @Req() request: { user?: AuthUser }) {
    return this.operations.read(id, request.user);
  }

  @Get('auto-status')
  @Header('Cache-Control', 'no-store')
  autoStatus() { return this.activation.status(); }

  @Post('auto-status-preview')
  @SyrveAsync('auto-status-preview')
  @Header('Cache-Control', 'no-store')
  previewAutoStatus(@Body() dto: SyrveRevisionDto, @Req() request: { user?: AuthUser }) {
    return this.activation.preview(dto, request.user);
  }

  @Post('enable-auto-status')
  @SyrveAsync('enable-auto-status')
  @Header('Cache-Control', 'no-store')
  enableAutoStatus(@Body() dto: EnableSyrveAutoStatusDto, @Req() request: { user?: AuthUser }) {
    return this.activation.enable(dto, request.user);
  }

  @Post('disable-auto-status')
  @Header('Cache-Control', 'no-store')
  disableAutoStatus(@Body() dto: SyrveRevisionDto, @Req() request: { user?: AuthUser }) {
    return this.activation.disable(dto, request.user);
  }

  @Get('readiness')
  @Header('Cache-Control', 'no-store')
  getReadiness() { return this.readiness.read(); }

  @Get()
  @Header('Cache-Control', 'no-store')
  getStatus() {
    return this.service.getStatus();
  }

  @Post('test')
  @SyrveAsync('test')
  test(@Body() dto: TestSyrveConnectionDto) {
    return this.service.test(dto);
  }

  @Post('connect')
  @SyrveAsync('connect')
  connect(
    @Body() dto: ConnectSyrveDto,
    @Req() request: { user?: AuthUser },
  ) {
    return this.service.connect(dto, request.user);
  }

  @Post('tables-preview')
  @SyrveAsync('tables-preview')
  @Header('Cache-Control', 'no-store')
  previewTables(@Body() dto: PreviewSyrveTablesDto) {
    return this.service.previewTables(dto);
  }

  @Post('orders-observation')
  @SyrveAsync('orders-observation')
  @Header('Cache-Control', 'no-store')
  observeOrders(@Body() dto: SyrveRevisionDto) {
    return this.service.observeOrders(dto);
  }

  @Post('orders-diagnostics')
  @SyrveAsync('orders-diagnostics')
  @Header('Cache-Control', 'no-store')
  orderDiagnostics(@Body() dto: SyrveRevisionDto) {
    return this.service.orderDiagnostics(dto);
  }

  @Post('bill-diagnostics')
  @SyrveAsync('bill-diagnostics')
  @Header('Cache-Control', 'no-store')
  billDiagnostics(@Body() dto: SyrveBillDiagnosticsDto) {
    return this.service.billDiagnostics(dto);
  }

  @Post('table-loading-preview')
  @SyrveAsync('table-loading-preview')
  @Header('Cache-Control', 'no-store')
  previewLoading(@Body() dto: SyrveRevisionDto, @Req() request: { user?: AuthUser }) {
    return this.loading.preview(dto, request.user);
  }

  @Post('table-loading')
  @SyrveAsync('table-loading')
  @Header('Cache-Control', 'no-store')
  loadTables(@Body() dto: ConfirmSyrveTableLoadingDto, @Req() request: { user?: AuthUser }) {
    return this.loading.load(dto, request.user);
  }

  @Post('recheck')
  @SyrveAsync('recheck')
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
