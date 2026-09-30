import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LogsModule } from '../logs/logs.module';
import { SyrveIntegration } from './entities/syrve-integration.entity';
import { SyrveIntegrationController } from './syrve-integration.controller';
import { SyrveIntegrationService } from './syrve-integration.service';
import { SyrveClient } from './syrve-client';

@Module({
  imports: [TypeOrmModule.forFeature([SyrveIntegration]), LogsModule],
  controllers: [SyrveIntegrationController],
  providers: [SyrveIntegrationService, SyrveClient],
  exports: [SyrveIntegrationService],
})
export class SyrveIntegrationModule {}
