import { Body, CanActivate, Controller, ExecutionContext, Header, HttpCode, Injectable,
  Param, Post, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { hasSyrveWebhookAuthorization } from './syrve-webhook';
import { SyrveWebhookService } from './syrve-webhook.service';

@Injectable()
export class SyrveWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    let authorized: boolean;
    try { authorized = hasSyrveWebhookAuthorization(request.headers.authorization, request.params.configurationRevision); }
    catch { throw new ServiceUnavailableException('Прийом сповіщень Syrve ще не налаштовано.'); }
    if (!authorized) throw new UnauthorizedException('Непідтверджене сповіщення Syrve.');
    return true;
  }
}

@Public()
@UseGuards(SyrveWebhookGuard)
@Controller('syrve-webhook')
export class SyrveWebhookController {
  constructor(private readonly webhooks: SyrveWebhookService) {}

  @Post(':configurationRevision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  receive(@Param('configurationRevision') revision: string, @Body() body: unknown) {
    return this.webhooks.receive(revision.toLowerCase(), body);
  }
}
