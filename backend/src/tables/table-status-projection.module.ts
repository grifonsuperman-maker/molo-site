import { Module } from '@nestjs/common';
import { SyrveStatusReadService } from '../syrve/syrve-status-read.service';
import { TableStatusProjectionService } from './table-status-projection.service';

@Module({ providers: [SyrveStatusReadService, TableStatusProjectionService], exports: [TableStatusProjectionService] })
export class TableStatusProjectionModule {}
