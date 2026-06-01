import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Copy,
  Move,
  Plus,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { api } from '../api/client';
import { mapApi } from '../api/map';
import type { FullMapResponse, MapObject, TableItem } from '../api/types';

type ItemKind = 'table' | 'object';

type SelectedItem = {
  kind: ItemKind;
  id: string;
};

type DragState = {
  kind: ItemKind;
  id: string;
  offsetX: number;
  offsetY: number;
};

type TableShape = 'square' | 'round' | 'rect';

type TemplateTable = {
  tableNumber: string;
  seats: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

type TemplateObject = {
  objectType: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  color: string;
};

const MAP_WIDTH = 1800;
const MAP_HEIGHT = 1120;

const TABLES: TemplateTable[] = [
  { tableNumber: '28', seats: 4, shape: 'rect', x: 180, y: 95, width: 86, height: 64 },
  { tableNumber: '29', seats: 4, shape: 'rect', x: 325, y: 95, width: 86, height: 64 },
  { tableNumber: '30', seats: 4, shape: 'rect', x: 470, y: 95, width: 86, height: 64 },
  { tableNumber: '31', seats: 4, shape: 'rect', x: 615, y: 95, width: 86, height: 64 },
  { tableNumber: '32', seats: 4, shape: 'rect', x: 760, y: 95, width: 86, height: 64 },
  { tableNumber: '33', seats: 4, shape: 'rect', x: 905, y: 95, width: 86, height: 64 },

  { tableNumber: '21', seats: 4, shape: 'square', x: 175, y: 235, width: 74, height: 74 },
  { tableNumber: '22', seats: 4, shape: 'square', x: 330, y: 235, width: 74, height: 74 },
  { tableNumber: '23', seats: 4, shape: 'square', x: 485, y: 235, width: 74, height: 74 },
  { tableNumber: '24', seats: 4, shape: 'square', x: 640, y: 235, width: 74, height: 74 },
  { tableNumber: '25', seats: 4, shape: 'square', x: 795, y: 235, width: 74, height: 74 },
  { tableNumber: '26', seats: 4, shape: 'square', x: 950, y: 235, width: 74, height: 74 },

  { tableNumber: '2', seats: 4, shape: 'square', x: 160, y: 430, width: 74, height: 74 },
  { tableNumber: '4', seats: 4, shape: 'square', x: 310, y: 430, width: 74, height: 74 },
  { tableNumber: '1', seats: 4, shape: 'square', x: 510, y: 430, width: 74, height: 74 },
  { tableNumber: '1', seats: 4, shape: 'square', x: 660, y: 430, width: 74, height: 74 },

  { tableNumber: '5', seats: 6, shape: 'round', x: 170, y: 585, width: 100, height: 100 },
  { tableNumber: '6', seats: 6, shape: 'round', x: 390, y: 585, width: 100, height: 100 },
  { tableNumber: '7', seats: 6, shape: 'round', x: 610, y: 585, width: 100, height: 100 },
  { tableNumber: '8', seats: 6, shape: 'round', x: 170, y: 755, width: 100, height: 100 },
  { tableNumber: '9', seats: 6, shape: 'round', x: 390, y: 755, width: 100, height: 100 },
  { tableNumber: '10', seats: 6, shape: 'round', x: 610, y: 755, width: 100, height: 100 },

  { tableNumber: '11', seats: 4, shape: 'square', x: 360, y: 925, width: 74, height: 74 },
  { tableNumber: '12', seats: 4, shape: 'square', x: 500, y: 925, width: 74, height: 74 },
  { tableNumber: '13', seats: 4, shape: 'square', x: 640, y: 925, width: 74, height: 74 },
  { tableNumber: '14', seats: 4, shape: 'square', x: 780, y: 925, width: 74, height: 74 },

  { tableNumber: '15', seats: 4, shape: 'square', x: 900, y: 440, width: 74, height: 74 },
  { tableNumber: '18', seats: 4, shape: 'square', x: 1040, y: 440, width: 74, height: 74 },
  { tableNumber: '16', seats: 4, shape: 'square', x: 900, y: 590, width: 74, height: 74 },
  { tableNumber: '19', seats: 4, shape: 'square', x: 1040, y: 590, width: 74, height: 74 },
  { tableNumber: '17', seats: 4, shape: 'square', x: 900, y: 740, width: 74, height: 74 },
  { tableNumber: '20', seats: 4, shape: 'square', x: 1040, y: 740, width: 74, height: 74 },

  { tableNumber: '37', seats: 6, shape: 'round', x: 1205, y: 410, width: 100, height: 100 },
  { tableNumber: '38', seats: 6, shape: 'round', x: 1205, y: 590, width: 100, height: 100 },
  { tableNumber: '39', seats: 6, shape: 'round', x: 1205, y: 780, width: 100, height: 100 },

  { tableNumber: '201', seats: 4, shape: 'square', x: 1450, y: 80, width: 78, height: 78 },
  { tableNumber: '29', seats: 4, shape: 'square', x: 1500, y: 200, width: 74, height: 74 },
  { tableNumber: '30', seats: 4, shape: 'square', x: 1500, y: 310, width: 74, height: 74 },
  { tableNumber: '31', seats: 4, shape: 'square', x: 1500, y: 420, width: 74, height: 74 },
  { tableNumber: '32', seats: 4, shape: 'square', x: 1500, y: 530, width: 74, height: 74 },
  { tableNumber: '33', seats: 4, shape: 'square', x: 1500, y: 640, width: 74, height: 74 },
  { tableNumber: '202', seats: 4, shape: 'square', x: 1500, y: 760, width: 78, height: 78 },
  { tableNumber: '41', seats: 4, shape: 'square', x: 1500, y: 885, width: 74, height: 74 },
  { tableNumber: '42', seats: 4, shape: 'square', x: 1500, y: 995, width: 74, height: 74 },
];

const OBJECTS: TemplateObject[] = [
  { objectType: 'fireplace', name: 'Камин', x: 560, y: 510, width: 90, height: 60, color: '#dc2626' },
  { objectType: 'bar', name: 'Бар', x: 95, y: 900, width: 250, height: 95, color: '#b7791f' },
  { objectType: 'tree', name: '', x: 1120, y: 350, width: 80, height: 80, color: '#166534' },
  { objectType: 'tree', name: '', x: 1285, y: 720, width: 80, height: 80, color: '#166534' },
  { objectType: 'tree', name: '', x: 40, y: 760, width: 70, height: 70, color: '#166534' },
  { objectType: 'lamp', name: '', x: 100, y: 340, width: 42, height: 42, color: '#facc15' },
  { objectType: 'lamp', name: '', x: 850, y: 330, width: 42, height: 42, color: '#facc15' },
  { objectType: 'lamp', name: '', x: 1330, y: 540, width: 42, height: 42, color: '#facc15' },
  { objectType: 'lamp', name: '', x: 1660, y: 540, width: 42, height: 42, color: '#facc15' },
  { objectType: 'window', name: 'Окно', x: 120, y: 38, width: 170, height: 24, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 390, y: 38, width: 170, height: 24, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 660, y: 38, width: 170, height: 24, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 40, y: 420, width: 24, height: 170, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 40, y: 620, width: 24, height: 170, color: '#38bdf8' },
];

const ADD_ITEMS = [
  { label: 'Мрамор', objectType: 'marble_tile', name: 'Мрамор', width: 250, height: 160, color: '#d8d3c7' },
  { label: 'Плитка', objectType: 'tile', name: 'Плитка', width: 250, height: 160, color: '#57534e' },
  { label: 'Тротуар', objectType: 'pavement', name: 'Тротуар', width: 250, height: 130, color: '#44403c' },
  { label: 'Вода', objectType: 'water', name: 'Вода', width: 300, height: 160, color: '#075985' },
  { label: 'Газон', objectType: 'grass', name: 'Газон', width: 250, height: 160, color: '#3f6212' },
  { label: 'Дерево', objectType: 'tree', name: '', width: 80, height: 80, color: '#166534' },
  { label: 'Камни', objectType: 'stones', name: '', width: 110, height: 60, color: '#78716c' },
  { label: 'Фонарь', objectType: 'lamp', name: '', width: 44, height: 44, color: '#facc15' },
  { label: 'Мост', objectType: 'bridge', name: 'Мост', width: 280, height: 80, color: '#8b5a2b' },
  { label: 'Камин', objectType: 'fireplace', name: 'Камин', width: 90, height: 60, color: '#dc2626' },
  { label: 'Окно', objectType: 'window', name: 'Окно', width: 160, height: 28, color: '#38bdf8' },
  { label: 'Диван', objectType: 'sofa', name: 'Диван', width: 170, height: 70, color: '#7f1d1d' },
];

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCreatedId(value: unknown) {
  const data = value as any;
  return String(data?.id || data?.data?.id || data?.data?.data?.id || '');
}

function objectLabel(object: MapObject) {
  if (object.objectType === 'tree') return '🌳';
  if (object.objectType === 'lamp') return '💡';
  if (object.objectType === 'fireplace') return '🔥';
  if (object.objectType === 'bar') return '🍸';
  if (object.objectType === 'window') return '';
  if (object.objectType === 'water') return '🌊';
  if (object.objectType === 'grass') return '🌿';
  if (object.objectType === 'stones') return '⚫';
  if (object.objectType === 'bridge') return '🌉';
  if (object.objectType === 'sofa') return '▰';
  return object.name || '';
}

function objectBackground(object: MapObject) {
  const color = object.color || '#525252';

  if (object.objectType === 'water') {
    return `radial-gradient(circle at 30% 20%, rgba(125,211,252,.45), transparent 25%), linear-gradient(135deg, #082f49, ${color}, #020617)`;
  }

  if (object.objectType === 'grass') {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 12px, #65a30d 12px, #65a30d 20px)`;
  }

  if (object.objectType === 'marble_tile') {
    return `linear-gradient(135deg, #fafaf9, ${color}, #a8a29e)`;
  }

  if (object.objectType === 'tile') {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 18px, #292524 18px, #292524 24px)`;
  }

  if (object.objectType === 'pavement') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 18px, #292524 18px, #292524 25px)`;
  }

  if (object.objectType === 'tree') {
    return `radial-gradient(circle, #22c55e 0%, ${color} 58%, #14532d 100%)`;
  }

  if (object.objectType === 'lamp') {
    return `radial-gradient(circle, #fef08a 0%, ${color} 35%, rgba(250,204,21,.2) 60%, transparent 100%)`;
  }

  if (object.objectType === 'fireplace') {
    return `radial-gradient(circle, #fde68a 0%, #f97316 38%, ${color} 70%, #450a0a 100%)`;
  }

  if (object.objectType === 'bar') {
    return `linear-gradient(135deg, #f59e0b, ${color}, #451a03)`;
  }

  if (object.objectType === 'window') {
    return `linear-gradient(180deg, #7dd3fc, ${color}, #0f172a)`;
  }

  if (object.objectType === 'bridge') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 20px, #f59e0b 20px, #f59e0b 24px)`;
  }

  return color;
}

function tableColors(table: TableItem, selected: boolean) {
  const status = String(table.status || 'free');

  if (selected) return 'border-amber-200 bg-amber-500 shadow-[0_0_30px_rgba(251,191,36,.9)]';
  if (status === 'occupied') return 'border-red-300 bg-red-700 shadow-[0_0_18px_rgba(239,68,68,.6)]';
  if (status === 'closed' || status === 'hidden') return 'border-neutral-400 bg-neutral-700 shadow-[0_0_12px_rgba(115,115,115,.5)]';
  if (status === 'reserved' || status === 'booked') return 'border-amber-300 bg-amber-600 shadow-[0_0_18px_rgba(245,158,11,.6)]';

  return 'border-emerald-300 bg-green-800 shadow-[0_0_18px_rgba(34,197,94,.65)]';
}

function Chair({ style }: { style: React.CSSProperties }) {
  return (
    <span
      style={style}
      className="absolute rounded-md border border-black/50 bg-stone-700 shadow-md"
    />
  );
}

function TableVisual({ table, selected }: { table: TableItem; selected: boolean }) {
  const isRound = table.shape === 'round';
  const isRect = table.shape === 'rect';

  return (
    <div className="relative h-full w-full overflow-visible">
      <Chair style={{ width: 22, height: 12, left: '50%', top: -13, transform: 'translateX(-50%)' }} />
      <Chair style={{ width: 22, height: 12, left: '50%', bottom: -13, transform: 'translateX(-50%)' }} />

      {!isRound && (
        <>
          <Chair style={{ width: 22, height: 12, left: 10, top: -13 }} />
          <Chair style={{ width: 22, height: 12, right: 10, top: -13 }} />
          <Chair style={{ width: 22, height: 12, left: 10, bottom: -13 }} />
          <Chair style={{ width: 22, height: 12, right: 10, bottom: -13 }} />
        </>
      )}

      {isRound && (
        <>
          <Chair style={{ width: 12, height: 22, left: -13, top: '50%', transform: 'translateY(-50%)' }} />
          <Chair style={{ width: 12, height: 22, right: -13, top: '50%', transform: 'translateY(-50%)' }} />
        </>
      )}

      {isRect && (
        <>
          <Chair style={{ width: 12, height: 22, left: -13, top: '50%', transform: 'translateY(-50%)' }} />
          <Chair style={{ width: 12, height: 22, right: -13, top: '50%', transform: 'translateY(-50%)' }} />
        </>
      )}

      <div
        className={`relative z-10 flex h-full w-full items-center justify-center border-2 text-sm font-bold text-white ${tableColors(
          table,
          selected,
        )} ${isRound ? 'rounded-full' : 'rounded-xl'}`}
      >
        {table.tableNumber}
      </div>
    </div>
  );
}

function StaticMapBackground() {
  const stone =
    'radial-gradient(circle at 15% 20%, rgba(245,158,11,.08), transparent 28%), repeating-linear-gradient(45deg, #302b25, #302b25 18px, #24201b 18px, #24201b 34px)';
  const darkStone =
    'radial-gradient(circle at 20% 20%, rgba(250,204,21,.08), transparent 30%), repeating-linear-gradient(45deg, #25221d, #25221d 16px, #171511 16px, #171511 32px)';
  const wood =
    'repeating-linear-gradient(90deg, #7c4a1e, #7c4a1e 24px, #4a2d14 24px, #4a2d14 30px)';
  const water =
    'radial-gradient(circle at 25% 18%, rgba(125,211,252,.35), transparent 20%), linear-gradient(135deg, #082f49, #075985, #020617)';

  return (
    <>
      <div className="absolute left-[55px] top-[55px] h-[290px] w-[1010px] rounded-[22px] border border-stone-500/45 shadow-[inset_0_0_45px_rgba(0,0,0,.8)]" style={{ background: darkStone }} />
      <div className="absolute left-[55px] top-[365px] h-[550px] w-[780px] rounded-[28px] border border-stone-500/45 shadow-[inset_0_0_45px_rgba(0,0,0,.8)]" style={{ background: stone }} />
      <div className="absolute left-[75px] top-[850px] h-[210px] w-[350px] rounded-[28px] border border-amber-800/40 bg-[#1d1710] shadow-[inset_0_0_35px_rgba(0,0,0,.9)]" />
      <div className="absolute left-[860px] top-[360px] h-[600px] w-[455px] rounded-[24px] border border-amber-700/40 shadow-[inset_0_0_35px_rgba(0,0,0,.7)]" style={{ background: wood }} />
      <div className="absolute left-[1320px] top-[30px] h-[1050px] w-[420px] rounded-[30px] border border-sky-500/20 shadow-[inset_0_0_70px_rgba(0,0,0,.85)]" style={{ background: water }} />
      <div className="absolute left-[1370px] top-[120px] h-[400px] w-[250px] rounded-[24px] border border-amber-600/40 shadow-[inset_0_0_30px_rgba(0,0,0,.7)]" style={{ background: wood }} />
      <div className="absolute left-[1360px] top-[600px] h-[145px] w-[285px] rounded-[20px] border border-amber-600/40 shadow-[inset_0_0_30px_rgba(0,0,0,.7)]" style={{ background: wood }} />

      <div className="absolute left-[405px] top-[185px] rounded-full bg-black/55 px-10 py-3 text-lg font-semibold text-stone-200">Банкетний зал</div>
      <div className="absolute left-[370px] top-[515px] rounded-full bg-black/55 px-10 py-3 text-lg font-semibold text-stone-200">Основний зал</div>
      <div className="absolute left-[1405px] top-[260px] rounded-full bg-black/55 px-10 py-3 text-lg font-semibold text-stone-200">Причал</div>
      <div className="absolute left-[1415px] top-[640px] rounded-full bg-black/55 px-10 py-3 text-lg font-semibold text-stone-200">Мост</div>
      <div className="absolute left-[115px] top-[930px] rounded-full bg-black/55 px-8 py-3 text-lg font-semibold text-stone-200">Бар</div>

      <div className="absolute left-[40px] top-[150px] rotate-[-90deg] text-3xl font-light tracking-widest text-stone-300/80">ВХОД</div>
      <div className="absolute left-[40px] top-[535px] rotate-[-90deg] text-3xl font-light tracking-widest text-stone-300/80">ВХОД</div>
    </>
  );
}

export default function ConstructorApp() {
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [zoom, setZoom] = useState(0.46);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  async function loadMap() {
    const data = (await mapApi.get()) as FullMapResponse;
    setMap(data);
  }

  useEffect(() => {
    loadMap().catch(() => setMessage('Не удалось загрузить карту'));
  }, []);

  function findSelectedItem(): any {
    if (!map || !selected) return null;
    if (selected.kind === 'table') {
      return (map.tables || []).find((item) => item.id === selected.id) || null;
    }
    return (map.objects || []).find((item) => item.id === selected.id) || null;
  }

  function updateLocalItem(kind: ItemKind, id: string, patch: Record<string, unknown>) {
    setMap((current) => {
      if (!current) return current;

      if (kind === 'table') {
        return {
          ...current,
          tables: (current.tables || []).map((item) =>
            item.id === id ? ({ ...item, ...patch } as TableItem) : item,
          ),
        };
      }

      return {
        ...current,
        objects: (current.objects || []).map((item) =>
          item.id === id ? ({ ...item, ...patch } as MapObject) : item,
        ),
      };
    });
  }

  function getPointerPosition(event: ReactPointerEvent<HTMLElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left + canvas.scrollLeft) / zoom,
      y: (event.clientY - rect.top + canvas.scrollTop) / zoom,
    };
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, kind: ItemKind, id: string) {
    event.preventDefault();
    event.stopPropagation();

    if (!map) return;

    const item =
      kind === 'table'
        ? (map.tables || []).find((table) => table.id === id)
        : (map.objects || []).find((object) => object.id === id);

    if (!item) return;

    const point = getPointerPosition(event);

    setSelected({ kind, id });
    setDragging({
      kind,
      id,
      offsetX: point.x - numberValue((item as any).x),
      offsetY: point.y - numberValue((item as any).y),
    });

    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;

    const point = getPointerPosition(event);

    updateLocalItem(dragging.kind, dragging.id, {
      x: Math.round(point.x - dragging.offsetX),
      y: Math.round(point.y - dragging.offsetY),
    });
  }

  function stopDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;

    setDragging(null);
    canvasRef.current?.releasePointerCapture(event.pointerId);
    setMessage('Передвинуто. Нажми «Сохранить».');
  }

  async function deleteEverything(data: FullMapResponse) {
    const objects = data.objects || [];
    const tables = data.tables || [];
    const zones = data.zones || [];

    for (const object of objects) {
      try {
        await api.delete(`/constructor/objects/${object.id}`);
      } catch {}
    }

    for (const table of tables) {
      try {
        await api.delete(`/tables/${table.id}`);
      } catch {}
    }

    for (const zone of zones) {
      try {
        await api.delete(`/zones/${zone.id}`);
      } catch {}
    }
  }

  async function createFreshMap() {
    const ok = window.confirm('Очистить старую карту и создать новую?');
    if (!ok) return;

    setLoading(true);
    setMessage('Очищаю старую карту...');

    try {
      const current = (await mapApi.get()) as FullMapResponse;
      await deleteEverything(current);

      setMessage('Создаю новую карту...');

      for (const object of OBJECTS) {
        await api.post('/constructor/objects', {
          ...object,
          rotation: object.rotation || 0,
        });
      }

      for (const table of TABLES) {
        await api.post('/tables', {
          ...table,
          rotation: table.rotation || 0,
        });
      }

      await loadMap();
      setSelected(null);
      setMessage('Новая карта создана. Теперь двигай столы/объекты и нажимай «Сохранить».');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания карты');
    } finally {
      setLoading(false);
    }
  }

  async function createTable(shape: TableShape) {
    setLoading(true);
    setMessage('');

    try {
      const tableNumber = String(((map?.tables || []).length || 0) + 1);
      const width = shape === 'round' ? 96 : shape === 'square' ? 84 : 135;
      const height = shape === 'round' ? 96 : shape === 'square' ? 84 : 78;

      const created = await api.post('/tables', {
        tableNumber,
        seats: 4,
        shape,
        x: 120,
        y: 120,
        width,
        height,
        rotation: 0,
      });

      const id = getCreatedId(created);
      await loadMap();

      if (id) setSelected({ kind: 'table', id });

      setMessage(`Добавлен стол ${tableNumber}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания стола');
    } finally {
      setLoading(false);
    }
  }

  async function createObject(item: (typeof ADD_ITEMS)[number]) {
    setLoading(true);
    setMessage('');

    try {
      const created = await api.post('/constructor/objects', {
        objectType: item.objectType,
        name: item.name,
        x: 150,
        y: 150,
        width: item.width,
        height: item.height,
        rotation: 0,
        color: item.color,
      });

      const id = getCreatedId(created);
      await loadMap();

      if (id) setSelected({ kind: 'object', id });

      setMessage(`${item.label} добавлен`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания элемента');
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    const item = findSelectedItem();
    if (!selected || !item) return;

    setLoading(true);
    setMessage('');

    try {
      if (selected.kind === 'table') {
        const table = item as TableItem;

        await api.patch(`/constructor/tables/${selected.id}/position`, {
          x: numberValue(table.x),
          y: numberValue(table.y),
          rotation: numberValue(table.rotation),
        });

        await api.patch(`/constructor/tables/${selected.id}/size`, {
          width: numberValue(table.width, 90),
          height: numberValue(table.height, 90),
        });

        await api.patch(`/tables/${selected.id}`, {
          tableNumber: table.tableNumber,
          seats: Number(table.seats) || 1,
          shape: table.shape,
        });

        if (table.status === 'free') await api.patch(`/tables/${selected.id}/free`);
        if (table.status === 'occupied') await api.patch(`/tables/${selected.id}/occupied`);
        if (table.status === 'closed') await api.patch(`/tables/${selected.id}/close`);

        await loadMap();
        setSelected({ kind: 'table', id: selected.id });
      }

      if (selected.kind === 'object') {
        const object = item as MapObject;

        await api.delete(`/constructor/objects/${selected.id}`);

        const created = await api.post('/constructor/objects', {
          objectType: object.objectType,
          name: object.name || '',
          x: numberValue(object.x),
          y: numberValue(object.y),
          width: numberValue(object.width, 100),
          height: numberValue(object.height, 100),
          rotation: numberValue(object.rotation),
          color: object.color || '#525252',
        });

        const newId = getCreatedId(created);

        await loadMap();

        if (newId) setSelected({ kind: 'object', id: newId });
        else setSelected(null);
      }

      setMessage('Сохранено');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  }

  async function duplicateSelected() {
    const item = findSelectedItem();
    if (!selected || !item) return;

    setLoading(true);
    setMessage('');

    try {
      if (selected.kind === 'table') {
        const table = item as TableItem;

        const created = await api.post('/tables', {
          tableNumber: `${table.tableNumber}`,
          seats: table.seats || 4,
          shape: table.shape || 'square',
          x: numberValue(table.x) + 35,
          y: numberValue(table.y) + 35,
          width: numberValue(table.width, 90),
          height: numberValue(table.height, 90),
          rotation: numberValue(table.rotation),
        });

        const id = getCreatedId(created);
        await loadMap();
        if (id) setSelected({ kind: 'table', id });
      }

      if (selected.kind === 'object') {
        const object = item as MapObject;

        const created = await api.post('/constructor/objects', {
          objectType: object.objectType,
          name: object.name || '',
          x: numberValue(object.x) + 35,
          y: numberValue(object.y) + 35,
          width: numberValue(object.width, 100),
          height: numberValue(object.height, 100),
          rotation: numberValue(object.rotation),
          color: object.color || '#525252',
        });

        const id = getCreatedId(created);
        await loadMap();
        if (id) setSelected({ kind: 'object', id });
      }

      setMessage('Скопировано');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка копирования');
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected() {
    if (!selected) return;

    setLoading(true);
    setMessage('');

    try {
      if (selected.kind === 'table') {
        await api.delete(`/tables/${selected.id}`);
      }

      if (selected.kind === 'object') {
        await api.delete(`/constructor/objects/${selected.id}`);
      }

      setSelected(null);
      await loadMap();
      setMessage('Удалено');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка удаления');
    } finally {
      setLoading(false);
    }
  }

  const selectedItem = findSelectedItem();

  return (
    <div className="mx-auto max-w-md px-4 py-5 pb-28">
      <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-black p-5 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">MOLO</p>

        <h1 className="mt-2 text-3xl font-semibold">Конструктор залу</h1>

        <p className="mt-2 text-sm text-neutral-300">
          Чистая версия карты: фон рисуется красиво, а столы и декор можно двигать, менять и сохранять.
        </p>

        <button
          disabled={loading}
          onClick={createFreshMap}
          className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-4 font-semibold text-neutral-950 disabled:opacity-50"
        >
          <Sparkles className="mr-2 inline h-5 w-5" />
          Очистить и создать новую карту
        </button>

        <label className="mt-4 block text-sm text-neutral-300">
          Масштаб: {Math.round(zoom * 100)}%
        </label>

        <input
          type="range"
          min="0.3"
          max="1.1"
          step="0.05"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-2 w-full"
        />
      </section>

      <section className="mt-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="text-lg font-semibold">Добавить стол</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button disabled={loading} onClick={() => createTable('square')} className="rounded-2xl bg-amber-300 px-2 py-3 text-xs font-semibold text-neutral-950 disabled:opacity-50">
            <Plus className="mr-1 inline h-4 w-4" />
            Квадрат
          </button>

          <button disabled={loading} onClick={() => createTable('round')} className="rounded-2xl bg-amber-300 px-2 py-3 text-xs font-semibold text-neutral-950 disabled:opacity-50">
            <Plus className="mr-1 inline h-4 w-4" />
            Круглый
          </button>

          <button disabled={loading} onClick={() => createTable('rect')} className="rounded-2xl bg-amber-300 px-2 py-3 text-xs font-semibold text-neutral-950 disabled:opacity-50">
            <Plus className="mr-1 inline h-4 w-4" />
            Прямой
          </button>
        </div>

        <h2 className="mt-5 text-lg font-semibold">Добавить декор</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {ADD_ITEMS.map((item) => (
            <button
              key={item.objectType}
              disabled={loading}
              onClick={() => createObject(item)}
              className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {selectedItem && selected && (
        <section className="mt-4 rounded-3xl border border-amber-300/40 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Выбрано</h2>

          <p className="mt-1 text-sm text-neutral-300">
            {selected.kind === 'table' ? 'Стол' : 'Декор'}
          </p>

          {selected.kind === 'table' && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-neutral-400">
                  Номер
                  <input
                    value={String((selectedItem as TableItem).tableNumber || '')}
                    onChange={(event) =>
                      updateLocalItem(selected.kind, selected.id, { tableNumber: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>

                <label className="text-xs text-neutral-400">
                  Мест
                  <input
                    type="number"
                    value={Number((selectedItem as TableItem).seats || 1)}
                    onChange={(event) =>
                      updateLocalItem(selected.kind, selected.id, { seats: Number(event.target.value) })
                    }
                    className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button onClick={() => updateLocalItem(selected.kind, selected.id, { status: 'free' })} className="rounded-xl bg-emerald-600 px-2 py-2 text-xs">
                  Свободен
                </button>

                <button onClick={() => updateLocalItem(selected.kind, selected.id, { status: 'occupied' })} className="rounded-xl bg-red-700 px-2 py-2 text-xs">
                  Занят
                </button>

                <button onClick={() => updateLocalItem(selected.kind, selected.id, { status: 'closed' })} className="rounded-xl bg-neutral-700 px-2 py-2 text-xs">
                  Скрыт
                </button>
              </div>
            </>
          )}

          {selected.kind === 'object' && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-neutral-400">
                Название
                <input
                  value={String((selectedItem as MapObject).name || '')}
                  onChange={(event) =>
                    updateLocalItem(selected.kind, selected.id, { name: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
                />
              </label>

              <label className="text-xs text-neutral-400">
                Цвет
                <input
                  type="color"
                  value={String((selectedItem as MapObject).color || '#525252')}
                  onChange={(event) =>
                    updateLocalItem(selected.kind, selected.id, { color: event.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-xl bg-neutral-800 px-2 py-1 outline-none"
                />
              </label>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-400">
              Ширина
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.width, 100))}
                onChange={(event) => updateLocalItem(selected.kind, selected.id, { width: Number(event.target.value) })}
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>

            <label className="text-xs text-neutral-400">
              Высота
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.height, 100))}
                onChange={(event) => updateLocalItem(selected.kind, selected.id, { height: Number(event.target.value) })}
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>

            <label className="text-xs text-neutral-400">
              X
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.x))}
                onChange={(event) => updateLocalItem(selected.kind, selected.id, { x: Number(event.target.value) })}
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>

            <label className="text-xs text-neutral-400">
              Y
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.y))}
                onChange={(event) => updateLocalItem(selected.kind, selected.id, { y: Number(event.target.value) })}
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                updateLocalItem(selected.kind, selected.id, {
                  rotation: numberValue(selectedItem.rotation) - 15,
                })
              }
              className="rounded-2xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-sm"
            >
              <RotateCcw className="mr-1 inline h-4 w-4" />
              Поворот -
            </button>

            <button
              onClick={() =>
                updateLocalItem(selected.kind, selected.id, {
                  rotation: numberValue(selectedItem.rotation) + 15,
                })
              }
              className="rounded-2xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-sm"
            >
              <RotateCw className="mr-1 inline h-4 w-4" />
              Поворот +
            </button>

            <button disabled={loading} onClick={saveSelected} className="rounded-2xl bg-emerald-400 px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50">
              <Save className="mr-1 inline h-4 w-4" />
              Сохранить
            </button>

            <button disabled={loading} onClick={duplicateSelected} className="rounded-2xl bg-blue-400 px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50">
              <Copy className="mr-1 inline h-4 w-4" />
              Копия
            </button>

            <button disabled={loading} onClick={deleteSelected} className="col-span-2 rounded-2xl bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">
              <Trash2 className="mr-1 inline h-4 w-4" />
              Удалить
            </button>
          </div>
        </section>
      )}

      {message && (
        <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-200">
          {message}
        </div>
      )}

      <section className="mt-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
          <span>Карта: {MAP_WIDTH} x {MAP_HEIGHT}</span>

          <button onClick={() => loadMap()} className="flex items-center gap-1 rounded-xl bg-neutral-800 px-2 py-1 text-xs">
            <RefreshCcw className="h-3 w-3" />
            обновить
          </button>

          <span className="flex items-center gap-1">
            <Move className="h-3 w-3" />
            двигай
          </span>
        </div>

        <div
          ref={canvasRef}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          className="relative h-[660px] overflow-auto rounded-3xl border border-neutral-800 bg-[#0b0a08]"
        >
          <div className="relative" style={{ width: MAP_WIDTH * zoom, height: MAP_HEIGHT * zoom }}>
            <div
              className="relative origin-top-left overflow-hidden rounded-[34px]"
              style={{
                width: MAP_WIDTH,
                height: MAP_HEIGHT,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                background: 'linear-gradient(135deg, #0b0a08, #17120d)',
              }}
            >
              <StaticMapBackground />

              {(map?.objects || []).map((object) => {
                const isSelected = selected?.kind === 'object' && selected.id === object.id;
                const isWindow = object.objectType === 'window';
                const isLamp = object.objectType === 'lamp';
                const isTree = object.objectType === 'tree';

                return (
                  <div
                    key={object.id}
                    onPointerDown={(event) => startDrag(event, 'object', object.id)}
                    className={`absolute flex touch-none items-center justify-center border text-center text-xs font-semibold text-white ${
                      isSelected ? 'border-amber-300' : 'border-white/20'
                    } ${isLamp || isTree ? 'rounded-full' : isWindow ? 'rounded-full' : 'rounded-2xl'}`}
                    style={{
                      left: numberValue(object.x),
                      top: numberValue(object.y),
                      width: numberValue(object.width, 80),
                      height: numberValue(object.height, 80),
                      transform: `rotate(${numberValue(object.rotation)}deg)`,
                      background: objectBackground(object),
                      boxShadow:
                        object.objectType === 'lamp'
                          ? '0 0 30px rgba(250,204,21,.9)'
                          : object.objectType === 'fireplace'
                            ? '0 0 28px rgba(249,115,22,.7)'
                            : '0 10px 22px rgba(0,0,0,.45)',
                    }}
                  >
                    <span className="px-1 drop-shadow">
                      {objectLabel(object)}
                      {object.name ? <><br />{object.name}</> : null}
                    </span>
                  </div>
                );
              })}

              {(map?.tables || []).map((table) => {
                const isSelected = selected?.kind === 'table' && selected.id === table.id;

                return (
                  <div
                    key={table.id}
                    onPointerDown={(event) => startDrag(event, 'table', table.id)}
                    className="absolute touch-none"
                    style={{
                      left: numberValue(table.x),
                      top: numberValue(table.y),
                      width: numberValue(table.width, 80),
                      height: numberValue(table.height, 70),
                      transform: `rotate(${numberValue(table.rotation)}deg)`,
                    }}
                  >
                    <TableVisual table={table} selected={isSelected} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-300">
          <span>🟢 свободен</span>
          <span>🟠 бронь</span>
          <span>🔴 занят</span>
          <span>⚫ скрыт</span>
          <span>🔥 камин</span>
          <span>▭ окно</span>
          <span>🌳 дерево</span>
          <span>🌊 вода</span>
          <span>💡 фонарь</span>
        </div>
      </section>
    </div>
  );
}
