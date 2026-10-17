import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeveloperController } from './developer.controller';
import { DeveloperService } from './developer.service';
import { DeveloperLoginThrottle } from './developer-login-throttle';

@Module({
  imports: [AuthModule],
  controllers: [DeveloperController],
  providers: [DeveloperService, DeveloperLoginThrottle],
})
export class DeveloperModule {}
