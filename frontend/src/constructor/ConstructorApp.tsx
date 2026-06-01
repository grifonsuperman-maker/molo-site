import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  RefreshCcw,
} from 'lucide-react';

import { api } from '../api/client';
import { mapApi } from '../api/map';
import type { FullMapResponse, MapObject, TableItem, Zone } from '../api/types';

type ItemKind = 'table' | 'zone' | 'object';

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

type CreatedResponse = {
  id?: unknown;
};

const DEFAULT_MAP_WIDTH = 1800;
const DEFAULT_MAP_HEIGHT = 1200;

const ZONE_PRESETS = [
  {
    label: 'Зал',
    name: 'Основний зал',
    color: '#27211a',
    width: 520,
    height: 320,
    pattern: 'plain',
  },
  {
    label: 'Мрамор',
    name: 'Мраморна плитка',
    color: '#d8d3c7',
    width: 520,
    height: 320,
    pattern: 'marble',
  },
  {
    label: 'Плитка',
    name: 'Плитка',
    color: '#78716c',
    width: 520,
    height: 320,
    pattern: 'tile',
  },
  {
    label: 'Тротуар',
    name: 'Тротуарна плитка',
    color: '#57534e',
    width: 520,
    height: 220,
    pattern: 'pavement',
  },
  {
    label: 'Газон',
    name: 'Газон',
    color: '#3f6212',
    width: 520,
    height: 320,
    pattern: 'grass',
  },
  {
    label: 'Вода',
    name: 'Вода',
    color: '#0369a1',
    width: 520,
    height: 220,
    pattern: 'water',
  },
  {
    label: 'Тераса',
    name: 'Деревʼяна тераса',
    color: '#7c4a1e',
    width: 520,
    height: 260,
    pattern: 'wood',
  },
];

const DECOR_ITEMS = [
  {
    label: 'Мрамор плитка',
    objectType: 'marble_tile',
    name: 'Мраморна плитка',
    width: 260,
    height: 180,
    color: '#ded8c8',
  },
  {
    label: 'Плитка',
    objectType: 'tile',
    name: 'Плитка',
    width: 260,
    height: 180,
    color: '#78716c',
  },
  {
    label: 'Тротуар',
    objectType: 'pavement',
    name: 'Тротуар',
    width: 280,
    height: 130,
    color: '#57534e',
  },
  {
    label: 'Газон',
    objectType: 'grass',
    name: 'Газон',
    width: 240,
    height: 160,
    color: '#3f7d20',
  },
  {
    label: 'Вода',
    objectType: 'water',
    name: 'Вода',
    width: 320,
    height: 150,
    color: '#0ea5e9',
  },
  {
    label: 'Дерево',
    objectType: 'tree',
    name: 'Дерево',
    width: 95,
    height: 95,
    color: '#166534',
  },
  {
    label: 'Камешки',
    objectType: 'stones',
    name: 'Камешки',
    width: 140,
    height: 80,
    color: '#71717a',
  },
  {
    label: 'Фонарь',
    objectType: 'lamp',
    name: 'Фонарь',
    width: 60,
    height: 100,
    color: '#facc15',
  },
  {
    label: 'Мост',
    objectType: 'bridge',
    name: 'Мост',
    width: 260,
    height: 80,
    color: '#8b5a2b',
  },
  {
    label: 'Бар',
    objectType: 'bar',
    name: 'Барная стойка',
    width: 320,
    height: 90,
    color: '#713f12',
  },
  {
    label: 'Диван',
    objectType: 'sofa',
    name: 'Диван',
    width: 190,
    height: 75,
    color: '#7f1d1d',
  },
  {
    label: 'Стул',
    objectType: 'chair',
    name: 'Стул',
    width: 55,
    height: 55,
    color: '#92400e',
  },
  {
    label: 'Камин',
    objectType: 'fireplace',
    name: 'Камин',
    width: 130,
    height: 80,
    color: '#dc2626',
  },
  {
    label: 'Окно',
    objectType: 'window',
    name: 'Окно',
    width: 140,
    height: 32,
    color: '#38bdf8',
  },
  {
    label: 'Дверь',
    objectType: 'door',
    name: 'Дверь',
    width: 95,
    height: 34,
    color: '#92400e',
  },
  {
    label: 'Стена',
    objectType: 'wall',
    name: 'Стена',
    width: 300,
    height: 28,
    color: '#525252',
  },
  {
    label: 'Забор кам.',
    objectType: 'stone_fence',
    name: 'Каменный забор',
    width: 280,
    height: 38,
    color: '#78716c',
  },
  {
    label: 'Забор дер.',
    objectType: 'wood_fence',
    name: 'Деревянный забор',
    width: 280,
    height: 38,
    color: '#854d0e',
  },
];

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCreatedId(value: unknown) {
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as CreatedResponse).id || '');
  }

  return '';
}

function getMapSize(map: FullMapResponse | null) {
  return {
    width: numberValue(map?.restaurant?.mapWidth, DEFAULT_MAP_WIDTH),
    height: numberValue(map?.restaurant?.mapHeight, DEFAULT_MAP_HEIGHT),
  };
}

function getObjectLabel(object: MapObject) {
  if (object.objectType === 'grass') return '🌿';
  if (object.objectType === 'tree') return '🌳';
  if (object.objectType === 'water') return '🌊';
  if (object.objectType === 'bridge') return '🌉';
  if (object.objectType === 'marble_tile') return '▦';
  if (object.objectType === 'tile') return '▦';
  if (object.objectType === 'pavement') return '▥';
  if (object.objectType === 'bar') return '🍸';
  if (object.objectType === 'sofa') return '▰';
  if (object.objectType === 'chair') return '▣';
  if (object.objectType === 'stones') return '⚫';
  if (object.objectType === 'lamp') return '💡';
  if (object.objectType === 'fireplace') return '🔥';
  if (object.objectType === 'window') return '▭';
  if (object.objectType === 'stone_fence') return '▤';
  if (object.objectType === 'wood_fence') return '▥';
  if (object.objectType === 'wall') return '━';
  if (object.objectType === 'door') return '🚪';

  return object.name || object.objectType;
}

function getObjectBackground(object: MapObject) {
  const color = object.color || '#404040';

  if (object.objectType === 'water') {
    return `linear-gradient(135deg, ${color}, #38bdf8, #075985)`;
  }

  if (object.objectType === 'grass') {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 10px, #65a30d 10px, #65a30d 18px)`;
  }

  if (object.objectType === 'tree') {
    return `radial-gradient(circle, #22c55e 0%, ${color} 58%, #3f6212 100%)`;
  }

  if (object.objectType === 'marble_tile') {
    return `linear-gradient(135deg, #fafafa, ${color}, #a3a3a3)`;
  }

  if (object.objectType === 'tile') {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 14px, #44403c 14px, #44403c 28px)`;
  }

  if (object.objectType === 'pavement') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 18px, #292524 18px, #292524 24px)`;
  }

  if (object.objectType === 'bridge') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 20px, #f59e0b 20px, #f59e0b 24px)`;
  }

  if (object.objectType === 'lamp') {
    return `radial-gradient(circle, #fef08a 0%, ${color} 45%, #1f2937 100%)`;
  }

  if (object.objectType === 'fireplace') {
    return `radial-gradient(circle, #facc15 0%, #ef4444 45%, ${color} 100%)`;
  }

  if (object.objectType === 'window') {
    return `linear-gradient(180deg, #7dd3fc, ${color}, #0f172a)`;
  }

  if (object.objectType === 'sofa') {
    return `linear-gradient(180deg, ${color}, #450a0a)`;
  }

  if (object.objectType === 'bar') {
    return `linear-gradient(135deg, ${color}, #d97706)`;
  }

  return color;
}

function getZoneBackground(zone: Zone) {
  const name = `${zone.name || ''}`.toLowerCase();
  const color = zone.color || '#262626';

  if (name.includes('мрамор')) {
    return `linear-gradient(135deg, #fafafa, ${color}, #a3a3a3)`;
  }

  if (name.includes('тротуар')) {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 20px, #292524 20px, #292524 25px)`;
  }

  if (name.includes('плит')) {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 18px, #44403c 18px, #44403c 34px)`;
  }

  if (name.includes('газон') || name.includes('трава')) {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 12px, #65a30d 12px, #65a30d 20px)`;
  }

  if (name.includes('вода')) {
    return `linear-gradient(135deg, ${color}, #38bdf8, #075985)`;
  }

  if (name.includes('терас') || name.includes('дерев')) {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 22px, #3f2a14 22px, #3f2a14 26px)`;
  }

  return color;
}

function getTableClass(table: TableItem, selected: boolean) {
  const base =
    'absolute flex touch-none items-center justify-center border-2 text-xs font-bold text-white shadow-[0_12px_24px_rgba(0,0,0,0.35)]';

  const shape =
    table.shape === 'round'
      ? 'rounded-full'
      : table.shape === 'square'
        ? 'rounded-xl'
        : 'rounded-2xl';

  const color = selected
    ? 'border-amber-300 bg-amber-500'
    : table.status === 'free'
      ? 'border-emerald-300 bg-emerald-600'
      : table.status === 'occupied'
        ? 'border-red-300 bg-red-700'
        : table.status === 'closed'
          ? 'border-neutral-400 bg-neutral-700'
          : 'border-amber-300 bg-amber-600';

  return `${base} ${shape} ${color}`;
}

export default function ConstructorApp() {
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [zoom, setZoom] = useState(0.55);
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
    loadMap().catch(() => {
      setMessage('Не удалось загрузить карту');
    });
  }, []);

  function findSelectedItem(): TableItem | Zone | MapObject | null {
    if (!map || !selected) return null;

    if (selected.kind === 'table') {
      return (map.tables || []).find((item) => item.id === selected.id) || null;
    }

    if (selected.kind === 'zone') {
      return (map.zones || []).find((item) => item.id === selected.id) || null;
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

      if (kind === 'zone') {
        return {
          ...current,
          zones: (current.zones || []).map((item) =>
            item.id === id ? ({ ...item, ...patch } as Zone) : item,
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

    if (!canvas) {
      return { x: 0, y: 0 };
    }

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
        : kind === 'zone'
          ? (map.zones || []).find((zone) => zone.id === id)
          : (map.objects || []).find((object) => object.id === id);

    if (!item) return;

    const point = getPointerPosition(event);

    setSelected({ kind, id });
    setDragging({
      kind,
      id,
      offsetX: point.x - numberValue(item.x),
      offsetY: point.y - numberValue(item.y),
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
    setMessage('Передвинуто. Нажми "Сохранить".');
  }

  async function saveSelected() {
    const item = findSelectedItem();

    if (!selected || !item) return;

    setLoading(true);
    setMessage('');

    try {
      const position = {
        x: numberValue(item.x),
        y: numberValue(item.y),
        rotation: numberValue(item.rotation),
      };

      const size = {
        width: numberValue(item.width, 100),
        height: numberValue(item.height, 100),
      };

      if (selected.kind === 'table') {
        const table = item as TableItem;

        await api.patch(`/constructor/tables/${selected.id}/position`, position);
        await api.patch(`/constructor/tables/${selected.id}/size`, size);
        await api.patch(`/tables/${selected.id}`, {
          tableNumber: table.tableNumber,
          seats: Number(table.seats) || 1,
          shape: table.shape,
        });

        if (table.status === 'free') {
          await api.patch(`/tables/${selected.id}/free`);
        }

        if (table.status === 'occupied') {
          await api.patch(`/tables/${selected.id}/occupied`);
        }

        if (table.status === 'closed') {
          await api.patch(`/tables/${selected.id}/close`);
        }

        await loadMap();
        setSelected({ kind: 'table', id: selected.id });
      }

      if (selected.kind === 'zone') {
        const zone = item as Zone;

        await api.patch(`/constructor/zones/${selected.id}/position`, position);
        await api.patch(`/constructor/zones/${selected.id}/size`, size);
        await api.patch(`/zones/${selected.id}`, {
          name: zone.name,
          color: zone.color || '#262626',
          description: zone.description || '',
          isVisible: zone.isVisible,
        });

        await loadMap();
        setSelected({ kind: 'zone', id: selected.id });
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
          color: object.color || '#404040',
        });

        const newId = getCreatedId(created);

        await loadMap();

        if (newId) {
          setSelected({ kind: 'object', id: newId });
        } else {
          setSelected(null);
        }
      }

      setMessage('Сохранено');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  }

  async function createTable(shape: 'square' | 'round' | 'rect') {
    setLoading(true);
    setMessage('');

    try {
      const tableNumber = String(((map?.tables || []).length || 0) + 1);

      const width = shape === 'round' ? 88 : shape === 'square' ? 88 : 140;
      const height = shape === 'round' ? 88 : shape === 'square' ? 88 : 82;

      const created = await api.post('/tables', {
        tableNumber,
        seats: 4,
        shape,
        x: 90,
        y: 90,
        width,
        height,
        rotation: 0,
      });

      const id = getCreatedId(created);

      await loadMap();

      if (id) {
        setSelected({ kind: 'table', id });
      }

      setMessage(`Добавлен стол ${tableNumber}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания стола');
    } finally {
      setLoading(false);
    }
  }

  async function createZone(preset: (typeof ZONE_PRESETS)[number]) {
    setLoading(true);
    setMessage('');

    try {
      const created = await api.post('/zones', {
        name: preset.name,
        color: preset.color,
        x: 60,
        y: 60,
        width: preset.width,
        height: preset.height,
        rotation: 0,
        isVisible: true,
      });

      const id = getCreatedId(created);

      await loadMap();

      if (id) {
        setSelected({ kind: 'zone', id });
      }

      setMessage(`${preset.label} добавлена`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания зоны');
    } finally {
      setLoading(false);
    }
  }

  async function createDecor(item: (typeof DECOR_ITEMS)[number]) {
    setLoading(true);
    setMessage('');

    try {
      const created = await api.post('/constructor/objects', {
        objectType: item.objectType,
        name: item.name,
        x: 140,
        y: 140,
        width: item.width,
        height: item.height,
        rotation: 0,
        color: item.color,
      });

      const id = getCreatedId(created);

      await loadMap();

      if (id) {
        setSelected({ kind: 'object', id });
      }

      setMessage(`${item.label} добавлено`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания декора');
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

      if (selected.kind === 'zone') {
        await api.delete(`/zones/${selected.id}`);
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

  async function expandMap(direction: 'left' | 'right' | 'top' | 'bottom') {
    setLoading(true);
    setMessage('');

    try {
      await api.post('/constructor/map/expand', {
        direction,
        amount: 300,
      });

      await loadMap();
      setMessage('Территория расширена');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка расширения карты');
    } finally {
      setLoading(false);
    }
  }

  const selectedItem = findSelectedItem();
  const size = getMapSize(map);

  return (
    <div className="mx-auto max-w-md px-4 py-5 pb-28">
      <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-black p-5 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">
          MOLO
        </p>

        <h1 className="mt-2 text-3xl font-semibold">Конструктор залу</h1>

        <p className="mt-2 text-sm text-neutral-300">
          Строй карту ресторана: столы, зоны, вода, мост, окна, камин, мрамор,
          трава, деревья и декор. Всё можно двигать, менять размер, цвет и
          поворачивать.
        </p>

        <label className="mt-4 block text-sm text-neutral-300">
          Масштаб: {Math.round(zoom * 100)}%
        </label>

        <input
          type="range"
          min="0.3"
          max="1.2"
          step="0.1"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-2 w-full"
        />
      </section>

      <section className="mt-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="text-lg font-semibold">Столы</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            disabled={loading}
            onClick={() => createTable('square')}
            className="rounded-2xl bg-amber-300 px-2 py-3 text-xs font-semibold text-neutral-950 disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Квадрат
          </button>

          <button
            disabled={loading}
            onClick={() => createTable('round')}
            className="rounded-2xl bg-amber-300 px-2 py-3 text-xs font-semibold text-neutral-950 disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Круглый
          </button>

          <button
            disabled={loading}
            onClick={() => createTable('rect')}
            className="rounded-2xl bg-amber-300 px-2 py-3 text-xs font-semibold text-neutral-950 disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Прямой
          </button>
        </div>

        <h2 className="mt-5 text-lg font-semibold">Зоны / покрытия</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {ZONE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              disabled={loading}
              onClick={() => createZone(preset)}
              className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <h2 className="mt-5 text-lg font-semibold">Декор</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {DECOR_ITEMS.map((item) => (
            <button
              key={item.objectType}
              disabled={loading}
              onClick={() => createDecor(item)}
              className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>

        <h2 className="mt-5 text-lg font-semibold">Расширить карту</h2>

        <div className="mt-3 grid grid-cols-4 gap-2">
          <button
            disabled={loading}
            onClick={() => expandMap('left')}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
          >
            ←
          </button>

          <button
            disabled={loading}
            onClick={() => expandMap('right')}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
          >
            →
          </button>

          <button
            disabled={loading}
            onClick={() => expandMap('top')}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
          >
            ↑
          </button>

          <button
            disabled={loading}
            onClick={() => expandMap('bottom')}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-2 py-3 text-xs disabled:opacity-50"
          >
            ↓
          </button>
        </div>
      </section>

      {selectedItem && selected && (
        <section className="mt-4 rounded-3xl border border-amber-300/40 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Выбрано</h2>

          <p className="mt-1 text-sm text-neutral-300">
            {selected.kind === 'table' && 'Стол'}
            {selected.kind === 'zone' && 'Зона'}
            {selected.kind === 'object' && 'Декор'}
          </p>

          {selected.kind === 'table' && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-neutral-400">
                  Номер
                  <input
                    value={(selectedItem as TableItem).tableNumber}
                    onChange={(event) =>
                      updateLocalItem(selected.kind, selected.id, {
                        tableNumber: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>

                <label className="text-xs text-neutral-400">
                  Мест
                  <input
                    type="number"
                    value={(selectedItem as TableItem).seats}
                    onChange={(event) =>
                      updateLocalItem(selected.kind, selected.id, {
                        seats: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={() =>
                    updateLocalItem(selected.kind, selected.id, { status: 'free' })
                  }
                  className="rounded-xl bg-emerald-600 px-2 py-2 text-xs"
                >
                  Свободен
                </button>

                <button
                  onClick={() =>
                    updateLocalItem(selected.kind, selected.id, {
                      status: 'occupied',
                    })
                  }
                  className="rounded-xl bg-red-700 px-2 py-2 text-xs"
                >
                  Занят
                </button>

                <button
                  onClick={() =>
                    updateLocalItem(selected.kind, selected.id, {
                      status: 'closed',
                    })
                  }
                  className="rounded-xl bg-neutral-700 px-2 py-2 text-xs"
                >
                  Скрыт
                </button>
              </div>
            </>
          )}

          {(selected.kind === 'zone' || selected.kind === 'object') && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-neutral-400">
                Название
                <input
                  value={
                    selected.kind === 'zone'
                      ? (selectedItem as Zone).name
                      : (selectedItem as MapObject).name || ''
                  }
                  onChange={(event) =>
                    updateLocalItem(selected.kind, selected.id, {
                      name: event.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
                />
              </label>

              <label className="text-xs text-neutral-400">
                Цвет
                <input
                  type="color"
                  value={
                    selected.kind === 'zone'
                      ? (selectedItem as Zone).color || '#262626'
                      : (selectedItem as MapObject).color || '#404040'
                  }
                  onChange={(event) =>
                    updateLocalItem(selected.kind, selected.id, {
                      color: event.target.value,
                    })
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
                onChange={(event) =>
                  updateLocalItem(selected.kind, selected.id, {
                    width: Number(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>

            <label className="text-xs text-neutral-400">
              Высота
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.height, 100))}
                onChange={(event) =>
                  updateLocalItem(selected.kind, selected.id, {
                    height: Number(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>

            <label className="text-xs text-neutral-400">
              X
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.x))}
                onChange={(event) =>
                  updateLocalItem(selected.kind, selected.id, {
                    x: Number(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-xl bg-neutral-800 px-3 py-2 text-sm text-white outline-none"
              />
            </label>

            <label className="text-xs text-neutral-400">
              Y
              <input
                type="number"
                value={Math.round(numberValue(selectedItem.y))}
                onChange={(event) =>
                  updateLocalItem(selected.kind, selected.id, {
                    y: Number(event.target.value),
                  })
                }
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

            <button
              disabled={loading}
              onClick={saveSelected}
              className="rounded-2xl bg-emerald-400 px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50"
            >
              <Save className="mr-1 inline h-4 w-4" />
              Сохранить
            </button>

            <button
              disabled={loading}
              onClick={deleteSelected}
              className="rounded-2xl bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
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
          <span>
            Карта: {size.width} x {size.height}
          </span>

          <button
            onClick={() => loadMap()}
            className="flex items-center gap-1 rounded-xl bg-neutral-800 px-2 py-1 text-xs"
          >
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
          className="relative h-[640px] overflow-auto rounded-3xl border border-neutral-800 bg-[#17140f]"
        >
          <div
            className="relative"
            style={{
              width: size.width * zoom,
              height: size.height * zoom,
            }}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: size.width,
                height: size.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                background:
                  'radial-gradient(circle at 20% 20%, rgba(245,158,11,0.08), transparent 30%), linear-gradient(135deg, #14100b, #241a10)',
              }}
            >
              {(map?.zones || []).map((zone) => {
                const isSelected = selected?.kind === 'zone' && selected.id === zone.id;

                return (
                  <div
                    key={zone.id}
                    onPointerDown={(event) => startDrag(event, 'zone', zone.id)}
                    className={`absolute touch-none rounded-[28px] border p-3 text-xs text-neutral-100 shadow-[0_14px_30px_rgba(0,0,0,0.35)] ${
                      isSelected ? 'border-amber-300' : 'border-white/20'
                    }`}
                    style={{
                      left: numberValue(zone.x),
                      top: numberValue(zone.y),
                      width: numberValue(zone.width, 200),
                      height: numberValue(zone.height, 150),
                      transform: `rotate(${numberValue(zone.rotation)}deg)`,
                      background: getZoneBackground(zone),
                    }}
                  >
                    {zone.isClosed ? '🔒 ' : ''}
                    {zone.name}
                  </div>
                );
              })}

              {(map?.objects || []).map((object) => {
                const isSelected =
                  selected?.kind === 'object' && selected.id === object.id;

                return (
                  <div
                    key={object.id}
                    onPointerDown={(event) => startDrag(event, 'object', object.id)}
                    className={`absolute flex touch-none items-center justify-center rounded-2xl border text-center text-xs font-semibold text-white shadow-[0_12px_24px_rgba(0,0,0,0.45)] ${
                      isSelected ? 'border-amber-300' : 'border-white/20'
                    }`}
                    style={{
                      left: numberValue(object.x),
                      top: numberValue(object.y),
                      width: numberValue(object.width, 80),
                      height: numberValue(object.height, 80),
                      transform: `rotate(${numberValue(object.rotation)}deg)`,
                      background: getObjectBackground(object),
                    }}
                  >
                    <span className="px-1 drop-shadow">
                      {getObjectLabel(object)}
                      <br />
                      {object.name}
                    </span>
                  </div>
                );
              })}

              {(map?.tables || []).map((table) => {
                const isSelected =
                  selected?.kind === 'table' && selected.id === table.id;

                return (
                  <button
                    key={table.id}
                    onPointerDown={(event) => startDrag(event, 'table', table.id)}
                    className={getTableClass(table, isSelected)}
                    style={{
                      left: numberValue(table.x),
                      top: numberValue(table.y),
                      width: numberValue(table.width, 80),
                      height: numberValue(table.height, 70),
                      transform: `rotate(${numberValue(table.rotation)}deg)`,
                    }}
                  >
                    {table.tableNumber}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-300">
          <span>🟢 свободен</span>
          <span>🔴 занят</span>
          <span>⚫ скрыт</span>
          <span>▦ мрамор</span>
          <span>🌊 вода</span>
          <span>🔥 камин</span>
          <span>▭ окно</span>
          <span>🌳 дерево</span>
          <span>🌉 мост</span>
        </div>
      </section>
    </div>
  );
}
