import { Injectable } from '@nestjs/common';
import { TableEntity, TableStatus } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { SyrveStatusReadService } from '../syrve/syrve-status-read.service';
import { disabledSyrveStatus, SyrveStatusSnapshot } from '../syrve/syrve-status-read.store';

@Injectable()
export class TableStatusProjectionService {
  // Keep the existing DI signature; table reads no longer depend on POS storage.
  constructor(_syrve: SyrveStatusReadService) {}

  async capture(tables: TableEntity[], view: 'today' | 'future' = 'today'): Promise<SyrveStatusSnapshot> {
    return disabledSyrveStatus();
  }

  async captureMap(tables: TableEntity[], zones: Zone[]): Promise<SyrveStatusSnapshot> {
    return disabledSyrveStatus();
  }

  private effective(table: TableEntity, snapshot: SyrveStatusSnapshot, parent?: Zone): TableStatus {
    // The worker commits each new bill event to this physical status. A read
    // must never replay an older open/closed bill over a newer manual action.
    return table.status;
  }

  physical<T extends TableEntity>(tables: T[], snapshot: SyrveStatusSnapshot, parent?: Zone): T[] {
    return tables;
  }

  zones<T extends Zone>(zones: T[], snapshot: SyrveStatusSnapshot): T[] {
    return zones;
  }

  window(table: TableEntity, snapshot: SyrveStatusSnapshot, input: {
    bookingDate: string; today: string; conflict: 'pending' | 'approved' | null;
  }): { status: TableStatus; reason: string | null } {
    // Exactly the existing booking-window rules. pending/reserved physical
    // values do not establish a conflict for a different date or time window.
    if (!table.isVisible || table.zone?.isVisible === false) return { status: 'closed', reason: 'hidden' };
    if (table.status === 'closed' || table.zone?.isClosed) return { status: 'closed', reason: 'closed' };
    if (input.bookingDate === input.today) {
      const status = this.effective(table, snapshot);
      if (status === 'occupied' || status === 'cleaning') return { status, reason: 'physical_status_today' };
    }
    if (input.conflict) return { status: input.conflict === 'pending' ? 'pending' : 'reserved', reason: 'booking_conflict' };
    return { status: 'free', reason: null };
  }
}
