import { Injectable } from '@nestjs/common';
import { TableEntity, TableStatus } from './entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
import { SyrveStatusReadService } from '../syrve/syrve-status-read.service';
import { disabledSyrveStatus, SyrveStatusSnapshot } from '../syrve/syrve-status-read.store';
import { projectSyrveTableStatus } from '../syrve/syrve-state-reducer';

type TableStatusRead = { table: TableEntity; parent?: Zone };

@Injectable()
export class TableStatusProjectionService {
  constructor(private readonly syrve: SyrveStatusReadService) {}

  async capture(tables: TableEntity[], view: 'today' | 'future' = 'today'): Promise<SyrveStatusSnapshot> {
    if (view === 'future') return disabledSyrveStatus();
    return this.captureFrames(tables.map((table) => ({ table })));
  }

  captureMap(tables: TableEntity[], zones: Zone[]): Promise<SyrveStatusSnapshot> {
    return this.captureFrames([...tables.map((table) => ({ table })),
      ...zones.flatMap((parent) => (parent.tables || []).map((table) => ({ table, parent })))]);
  }

  private async captureFrames(reads: TableStatusRead[]): Promise<SyrveStatusSnapshot> {
    const snapshot = await this.syrve.snapshot(reads.map(({ table }) => table.id));
    if (!snapshot.syncEnabled) return snapshot;
    // Table and zone queries are independent. A zone-only change does not
    // advance table.updatedAt, so compare the actual visibility/closure context
    // used by each representation as well as its physical table version.
    const seen = new Map<string, string>(), ambiguous = new Set<string>();
    for (const { table, parent } of reads) {
      const zone = parent || table.zone;
      const version = JSON.stringify([table.status, new Date(table.updatedAt).getTime(), table.isVisible === false,
        zone?.id || null, zone?.isVisible === false, Boolean(zone?.isClosed)]);
      if (seen.has(table.id) && seen.get(table.id) !== version) ambiguous.add(table.id);
      seen.set(table.id, version);
    }
    return { ...snapshot, tables: new Map([...snapshot.tables].filter(([id]) => !ambiguous.has(id))) };
  }

  private effective(table: TableEntity, snapshot: SyrveStatusSnapshot, parent?: Zone): TableStatus {
    const entry = snapshot.syncEnabled ? snapshot.tables.get(table.id) : null;
    if (!entry || entry.physicalStatus !== table.status
      || entry.physicalUpdatedAt !== new Date(table.updatedAt).getTime()) return table.status;
    const zone = parent || table.zone;
    const pos = projectSyrveTableStatus(entry.state, { currentScope: entry.currentScope, syncEnabled: true, view: 'today',
      hidden: table.isVisible === false || zone?.isVisible === false, zoneClosed: Boolean(zone?.isClosed),
      manualStatus: 'free', booking: 'none', checkedIn: false });
    // Preserve the role's existing manual/visibility representation. POS can
    // only add occupied; it cannot clear any existing source or close a table.
    return pos === 'occupied' && table.status !== 'closed' ? 'occupied' : table.status;
  }

  physical<T extends TableEntity>(tables: T[], snapshot: SyrveStatusSnapshot, parent?: Zone): T[] {
    if (!snapshot.syncEnabled) return tables;
    return tables.map((table) => {
      const status = this.effective(table, snapshot, parent);
      return status === table.status ? table : { ...table, status };
    });
  }

  zones<T extends Zone>(zones: T[], snapshot: SyrveStatusSnapshot): T[] {
    if (!snapshot.syncEnabled) return zones;
    return zones.map((zone) => zone.tables ? { ...zone, tables: this.physical(zone.tables, snapshot, zone) } : zone);
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
