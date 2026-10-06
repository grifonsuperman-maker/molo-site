import type { SyrveCatalogPreview } from '../api/syrve';

const CONFLICT_LABELS: Record<SyrveCatalogPreview['conflicts'][number]['code'], string> = {
  already_linked: 'Стіл уже має інший підтверджений зв’язок',
  duplicate_syrve_id: 'Syrve повернув той самий стіл кілька разів',
  duplicate_syrve_number: 'Кілька столів Syrve мають однаковий номер',
  duplicate_molo_number: 'Кілька столів MOLO мають однаковий номер',
  unsupported_syrve_number: 'Номер Syrve потребує ручної перевірки',
  unsupported_molo_number: 'Номер MOLO потребує ручної перевірки',
};


function tableNumberRanges(values: number[]) {
  const numbers = [...new Set(values)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let start = 0; start < numbers.length;) {
    let end = start;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end] + 1) end++;
    ranges.push(start === end ? String(numbers[start]) : `${numbers[start]}-${numbers[end]}`);
    start = end + 1;
  }
  return ranges.join(', ');
}

export default function SyrveCatalogPreviewPanel({ preview }: { preview: SyrveCatalogPreview }) {
  const { summary } = preview;
  const counts: [string, number][] = [
    ['Столів Syrve', summary.syrveTables], ['Запропоновано пар', summary.proposals],
    ['Не знайдено в MOLO', summary.missingInMolo], ['Не знайдено в доступних секціях Syrve', summary.missingInSyrve],
    ['Конфліктів', summary.conflicts], ['Видалених у Syrve', summary.deletedTables],
    ['Збережених зв’язків', summary.confirmedLinks || 0],
  ];
  return (
    <div className="mt-4 rounded-2xl border border-cyan-200/25 bg-black/30 p-4">
      <h3 className="text-lg font-black">Перевірка столів · {preview.organization.name}</h3>
      <p className="mt-2 text-sm text-white/55">Це пропозиції. Нові зв’язки ще не збережені, карту не змінено.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {counts.map(([label, count]) => <div key={label} className="rounded-xl border border-white/10 p-3"><dt className="text-xs text-white/50">{label}</dt><dd className="mt-1 text-2xl font-black">{count}</dd></div>)}
      </dl>
      <ul className="mt-3 space-y-2 text-sm text-amber-100/80">
        {preview.diagnostics.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>
      {!!preview.diagnostics.receivedSections?.length && <details className="mt-3 text-sm" open>
        <summary className="cursor-pointer font-bold">Отримані секції Syrve ({preview.diagnostics.receivedSections.length})</summary>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-white/65">
          {preview.diagnostics.receivedSections.map((section, index) => <li key={`${section.terminalGroupName}:${section.sectionName}:${index}`}>
            <p><span className="font-bold text-white/80">{section.sectionName || 'Секція без назви'}</span> · {section.terminalGroupName || 'Каса без назви'}</p>
            <p className="mt-1 text-xs text-white/45">Столи: №{tableNumberRanges(section.tableNumbers)} · всього {section.tableNumbers.length}</p>
          </li>)}
        </ul>
      </details>}
      {!!preview.confirmedLinks?.length && <details className="mt-3 text-sm" open>
        <summary className="cursor-pointer font-bold">Підтверджені зв’язки ({preview.confirmedLinks.length})</summary>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-white/65">
          {preview.confirmedLinks.map((link) => <li key={link.moloTableId}>MOLO №{link.moloTableNumber || 'невідомий'} ↔ Syrve · останній номер №{link.lastKnownNumber}</li>)}
        </ul>
      </details>}
      <details className="mt-4 text-sm" open>
        <summary className="cursor-pointer font-bold">Пропозиції зіставлення ({summary.proposals})</summary>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-white/65">
          {preview.proposals.map((pair) => <li key={pair.moloTableId}>MOLO №{pair.moloTableNumber} ↔ Syrve №{pair.syrveTableNumber} · {pair.sectionName || 'Секція без назви'}</li>)}
        </ul>
      </details>
      <details className="mt-3 text-sm" open={summary.missingInMolo > 0}>
        <summary className="cursor-pointer font-bold">Не знайдено в MOLO ({summary.missingInMolo})</summary>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-white/65">
          {preview.missingInMolo.map((table) => <li key={table.id}>Syrve №{table.number} · {table.name || 'Без назви'} · {table.sectionName || 'Секція без назви'}</li>)}
        </ul>
      </details>
      <details className="mt-3 text-sm" open={summary.missingInSyrve > 0}>
        <summary className="cursor-pointer font-bold">MOLO поза отриманим списком Syrve ({summary.missingInSyrve})</summary>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-white/65">
          {preview.missingInSyrve.map((table) => <li key={table.id}>MOLO №{table.tableNumber}</li>)}
        </ul>
      </details>
      <details className="mt-3 text-sm" open={summary.conflicts > 0}>
        <summary className="cursor-pointer font-bold">Конфлікти ({summary.conflicts})</summary>
        <ul className="mt-2 max-h-60 space-y-3 overflow-y-auto text-amber-100/80">
          {preview.conflicts.map((conflict, index) => <li key={index}>
            <p>{CONFLICT_LABELS[conflict.code]}{conflict.number !== null ? ` · №${conflict.number}` : ''}</p>
            <p className="mt-1 text-xs text-white/40">Столів у конфлікті: MOLO — {conflict.moloTableIds.length}, Syrve — {conflict.syrveTableIds.length}</p>
          </li>)}
        </ul>
      </details>
      {summary.deletedTables > 0 && <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-bold">Видалені столи Syrve виключено ({summary.deletedTables})</summary>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-white/65">
          {preview.deletedTables.map((table, index) => <li key={`${table.id}-${index}`}>Syrve №{table.number} · {table.name || 'Без назви'}</li>)}
        </ul>
      </details>}
    </div>
  );
}
