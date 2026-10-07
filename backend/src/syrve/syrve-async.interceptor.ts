import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SyrveOperationsService } from './syrve-operations.service';

export const SyrveAsync = (kind: string) => SetMetadata('syrve-async-operation', kind);
@Injectable()
export class SyrveAsyncInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly operations: SyrveOperationsService,
    private readonly auth: AuthService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const kind = this.reflector.get<string>('syrve-async-operation', context.getHandler());
    if (!kind) return next.handle();
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.slice('Bearer '.length);
    // The JWT is retained only in this running closure; recheck credential
    // rotation before every quota-paced request, including after tab sleep.
    return from(this.operations.start(request.user, kind, () => lastValueFrom(next.handle()), () => this.auth.verifyToken(token)));
  }
}
