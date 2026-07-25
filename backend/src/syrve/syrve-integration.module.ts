import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LogsModule } from '../logs/logs.module';
import { SyrveIntegration } from './entities/syrve-integration.entity';
import { SyrveIntegrationController } from './syrve-integration.controller';
import { SyrveIntegrationService } from './syrve-integration.service';

@Module({
  imports: [TypeOrmModule.forFeature([SyrveIntegration]), LogsModule],
  controllers: [SyrveIntegrationController],
  providers: [SyrveIntegrationService],
  exports: [SyrveIntegrationService],
})
export class SyrveIntegrationModule {}
