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
import { SyrveTableRenamingService } from './syrve-table-renaming.service';
import { SyrveTableRenamingController } from './syrve-table-renaming.controller';
import { SyrveWorkerService } from './syrve-worker.service';
import { SyrveReadinessService } from './syrve-readiness.service';
import { SyrveTableLoadingService } from './syrve-table-loading.service';
import { SyrveTableLoadingStore } from './syrve-table-loading.store';

@Module({
  imports: [TypeOrmModule.forFeature([SyrveIntegration, SyrveTableLink, TableEntity]), LogsModule],
  controllers: [SyrveIntegrationController, SyrveTableRenamingController],
  providers: [SyrveIntegrationService, SyrveClient, SyrveSettingsStore, SyrveTableRenamingService, SyrveWorkerService, SyrveReadinessService,
    SyrveTableLoadingService, SyrveTableLoadingStore],
  exports: [SyrveIntegrationService, SyrveTableRenamingService],
})
export class SyrveIntegrationModule {}
