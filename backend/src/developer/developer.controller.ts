import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/types/auth-user.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeveloperService } from './developer.service';
import { DeveloperLoginDto } from './dto/developer-login.dto';

@Controller('developer')
export class DeveloperController {
  constructor(private readonly service: DeveloperService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() dto: DeveloperLoginDto, @Req() request: Request) {
    return this.service.login(dto, request.ip || request.socket.remoteAddress || 'unknown');
  }

  @Roles('developer')
  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(@CurrentUser() user: AuthUser) {
    return this.service.session(user);
  }
}
