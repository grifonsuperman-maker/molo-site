import { buildSyrveCatalogPreview, SyrveCatalog } from './syrve-catalog';
import type { SyrveTableLink } from './entities/syrve-table-link.entity';

export function buildSyrveMappingPreview(catalog: SyrveCatalog, tables: { id: string; tableNumber: string }[], links: SyrveTableLink[]) {
  const preview = buildSyrveCatalogPreview(catalog, tables);
  const conflicts: { code: string; number: string | null; moloTableIds: string[]; syrveTableIds: string[] }[] = [...preview.conflicts];
  const proposals = preview.proposals.filter((pair) => {
    const moloLink = links.find((link) => link.moloTableId === pair.moloTableId);
    const providerLink = links.find((link) => link.organizationId === catalog.organization.id && link.syrveTableId === pair.syrveTableId);
    if (!moloLink && !providerLink) return true;
    if (moloLink?.organizationId !== catalog.organization.id || moloLink?.syrveTableId !== pair.syrveTableId) {
      conflicts.push({ code: 'already_linked', number: pair.moloTableNumber,
        moloTableIds: [pair.moloTableId], syrveTableIds: [pair.syrveTableId] });
    }
    return false;
  });
  const confirmedLinks = links.map((link) => ({ moloTableId: link.moloTableId, syrveTableId: link.syrveTableId,
    organizationId: link.organizationId, moloTableNumber: tables.find((table) => table.id === link.moloTableId)?.tableNumber || null,
    lastKnownNumber: link.lastKnownNumber }));
  return { ...preview, proposals, conflicts, confirmedLinks,
    summary: { ...preview.summary, proposals: proposals.length, conflicts: conflicts.length, confirmedLinks: confirmedLinks.length } };
}
