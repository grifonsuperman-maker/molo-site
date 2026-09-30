import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LogsModule } from '../logs/logs.module';
import { TableEntity } from '../tables/entities/table.entity';
import { SyrveIntegration } from './entities/syrve-integration.entity';
import { SyrveTableLink } from './entities/syrve-table-link.entity';
import { SyrveIntegrationController } from './syrve-integration.controller';
import { SyrveIntegrationService } from './syrve-integration.service';
import { SyrveClient } from './syrve-client';
import { SyrveSettingsStore } from './syrve-settings.store';

@Module({
  imports: [TypeOrmModule.forFeature([SyrveIntegration, SyrveTableLink, TableEntity]), LogsModule],
  controllers: [SyrveIntegrationController],
  providers: [SyrveIntegrationService, SyrveClient, SyrveSettingsStore],
  exports: [SyrveIntegrationService],
})
export class SyrveIntegrationModule {}
