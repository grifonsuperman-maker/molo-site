import { Body, CanActivate, Controller, ExecutionContext, Header, HttpCode, Injectable,
  Param, Post, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { hasSyrveWebhookAuthorization } from './syrve-webhook';
import { SyrveWebhookService } from './syrve-webhook.service';
import { syrveWebhookObservation } from './syrve-webhook-observation';

@Injectable()
export class SyrveWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const observation = syrveWebhookObservation(request);
    let authorized: boolean;
    try { authorized = hasSyrveWebhookAuthorization(request.headers.authorization, request.params.configurationRevision); }
    catch {
      const error = new ServiceUnavailableException('Прийом сповіщень Syrve ще не налаштовано.');
      observation.rejectAs('AUTHORIZATION_UNAVAILABLE'); observation.rejected(error); throw error;
    }
    if (!authorized) {
      const error = new UnauthorizedException('Непідтверджене сповіщення Syrve.');
      observation.rejectAs('UNAUTHORIZED'); observation.rejected(error); throw error;
    }
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
  receive(@Param('configurationRevision') revision: string, @Body() body: unknown, @Req() request: object) {
    return this.webhooks.receive(revision.toLowerCase(), body, syrveWebhookObservation(request));
  }
}
