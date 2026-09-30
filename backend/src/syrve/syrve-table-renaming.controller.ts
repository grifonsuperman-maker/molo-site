import { Controller, Get, Header } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SyrveTableRenamingService } from './syrve-table-renaming.service';

@Roles('owner')
@Controller('syrve-integration/table-renaming')
export class SyrveTableRenamingController {
  constructor(private readonly service: SyrveTableRenamingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  diagnostics() { return this.service.diagnostics(); }
}
