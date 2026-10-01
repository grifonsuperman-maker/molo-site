import { Module } from '@nestjs/common';
import { SyrveSettingsStore } from './syrve-settings.store';
import { SyrveStaffActionsService } from './syrve-staff-actions.service';

// No client, credentials, scheduler or dependency on the table module.
@Module({
  providers: [SyrveSettingsStore, SyrveStaffActionsService],
  exports: [SyrveStaffActionsService],
})
export class SyrveStaffActionsModule {}
