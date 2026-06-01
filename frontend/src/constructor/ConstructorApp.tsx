import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  Copy,
  Move,
  Plus,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Save,
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

type PaletteItem = {
  label: string;
  objectType: string;
  name: string;
  width: number;
  height: number;
  color: string;
};

const DEFAULT_MAP_WIDTH = 2200;
const DEFAULT_MAP_HEIGHT = 1500;

const FLOOR_ITEMS: PaletteItem[] = [
  {
    label: 'Зона',
    objectType: 'zone_rect',
    name: 'Зона',
    width: 520,
    height: 320,
    color: '#2b2924',
  },
  {
    label: 'Зона овал',
    objectType: 'zone_oval',
    name: 'Зона',
    width: 420,
    height: 260,
    color: '#2b2924',
  },
  {
    label: 'Мрамор',
    objectType: 'floor_marble',
    name: 'Мрамор',
    width: 520,
    height: 320,
    color: '#d8d3c7',
  },
  {
    label: 'Плитка',
    objectType: 'floor_tile',
    name: 'Плитка',
    width: 520,
    height: 320,
    color: '#57534e',
  },
  {
    label: 'Тротуар',
    objectType: 'floor_pavement',
    name: 'Тротуар',
    width: 520,
    height: 260,
    color: '#44403c',
  },
  {
    label: 'Дерево',
    objectType: 'floor_wood',
    name: 'Дерево',
    width: 520,
    height: 320,
    color: '#7c4a1e',
  },
  {
    label: 'Газон',
    objectType: 'floor_grass',
    name: 'Газон',
    width: 520,
    height: 320,
    color: '#3f6212',
  },
  {
    label: 'Вода',
    objectType: 'floor_water',
    name: 'Вода',
    width: 520,
    height: 320,
    color: '#075985',
  },
];

const BUILD_ITEMS: PaletteItem[] = [
  {
    label: 'Стена',
    objectType: 'wall',
    name: '',
    width: 360,
    height: 28,
    color: '#57534e',
  },
  {
    label: 'Окно',
    objectType: 'window',
    name: 'Окно',
    width: 180,
    height: 28,
    color: '#38bdf8',
  },
  {
    label: 'Дверь',
    objectType: 'door',
    name: 'Дверь',
    width: 110,
    height: 36,
    color: '#92400e',
  },
  {
    label: 'Забор кам.',
    objectType: 'stone_fence',
    name: '',
    width: 300,
    height: 42,
    color: '#78716c',
  },
  {
    label: 'Забор дер.',
    objectType: 'wood_fence',
    name: '',
    width: 300,
    height: 42,
    color: '#854d0e',
  },
  {
    label: 'Мост',
    objectType: 'bridge',
    name: 'Мост',
    width: 300,
    height: 90,
    color: '#8b5a2b',
  },
  {
    label: 'Причал',
    objectType: 'pier',
    name: 'Причал',
    width: 320,
    height: 160,
    color: '#7c4a1e',
  },
  {
    label: 'Камин',
    objectType: 'fireplace',
    name: 'Камин',
    width: 120,
    height: 80,
    color: '#dc2626',
  },
];

const FURNITURE_ITEMS: PaletteItem[] = [
  {
    label: 'Бар',
    objectType: 'bar',
    name: 'Бар',
    width: 320,
    height: 110,
    color: '#b7791f',
  },
  {
    label: 'Диван',
    objectType: 'sofa',
    name: 'Диван',
    width: 210,
    height: 85,
    color: '#7f1d1d',
  },
  {
    label: 'Стул',
    objectType: 'chair',
    name: '',
    width: 58,
    height: 58,
    color: '#92400e',
  },
  {
    label: 'Дерево',
    objectType: 'tree',
    name: '',
    width: 90,
    height: 90,
    color: '#166534',
  },
  {
    label: 'Камни',
    objectType: 'stones',
    name: '',
    width: 130,
    height: 75,
    color: '#78716c',
  },
  {
    label: 'Фонарь',
    objectType: 'lamp',
    name: '',
    width: 60,
    height: 60,
    color: '#facc15',
  },
  {
    label: 'Текст',
    objectType: 'text',
    name: 'Текст',
    width: 230,
    height: 64,
    color: '#111827',
  },
  {
    label: 'Цифра',
    objectType: 'number',
    name: '1',
    width: 80,
    height: 70,
    color: '#111827',
  },
];

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCreatedId(value: unknown) {
  const data = value as any;
  return String(data?.id || data?.data?.id || data?.data?.data?.id || '');
}

function getMapWidth(map: FullMapResponse | null) {
  return numberValue((map as any)?.restaurant?.mapWidth, DEFAULT_MAP_WIDTH);
}

function getMapHeight(map: FullMapResponse | null) {
  return numberValue((map as any)?.restaurant?.mapHeight, DEFAULT_MAP_HEIGHT);
}

function isFloorObject(objectType: string) {
  return objectType.startsWith('floor_') || objectType.startsWith('zone_');
}

function isOvalObject(objectType: string) {
  return objectType.includes('oval') || objectType === 'floor_water_oval';
}

function getObjectLayer(objectType: string) {
  if (objectType.startsWith('floor_') || objectType.startsWith('zone_')) return 1;
  if (objectType === 'floor_water' || objectType === 'bridge' || objectType === 'pier') return 2;
  if (
    objectType === 'wall' ||
    objectType === 'window' ||
    objectType === 'door' ||
    objectType === 'stone_fence' ||
    objectType === 'wood_fence'
  ) {
    return 3;
  }
  if (objectType === 'bar' || objectType === 'sofa' || objectType === 'chair' || objectType === 'fireplace') {
    return 4;
  }
  if (objectType === 'lamp' || objectType === 'tree' || objectType === 'stones') return 5;
  if (objectType === 'text' || objectType === 'number') return 8;
  return 4;
}

function getObjectBackground(object: MapObject) {
  const type = String(object.objectType || '');
  const color = String(object.color || '#525252');

  if (type === 'floor_marble') {
    return `
      linear-gradient(135deg, rgba(255,255,255,.85), rgba(255,255,255,.12)),
      repeating-linear-gradient(45deg, ${color}, ${color} 22px, #f5f5f4 22px, #f5f5f4 26px, #a8a29e 26px, #a8a29e 44px)
    `;
  }

  if (type === 'floor_tile') {
    return `
      radial-gradient(circle at 20% 20%, rgba(245,158,11,.08), transparent 28%),
      repeating-linear-gradient(45deg, ${color}, ${color} 18px, #292524 18px, #292524 34px)
    `;
  }

  if (type === 'floor_pavement') {
    return `
      repeating-linear-gradient(90deg, ${color}, ${color} 22px, #292524 22px, #292524 28px),
      repeating-linear-gradient(0deg, transparent, transparent 22px, rgba(0,0,0,.3) 22px, rgba(0,0,0,.3) 28px)
    `;
  }

  if (type === 'floor_wood' || type === 'bridge' || type === 'pier') {
    return `
      repeating-linear-gradient(90deg, ${color}, ${color} 24px, #3f2a14 24px, #3f2a14 31px),
      linear-gradient(180deg, rgba(255,255,255,.12), rgba(0,0,0,.18))
    `;
  }

  if (type === 'floor_grass') {
    return `
      radial-gradient(circle at 18% 25%, rgba(190,242,100,.18), transparent 26%),
      repeating-linear-gradient(45deg, ${color}, ${color} 12px, #65a30d 12px, #65a30d 20px)
    `;
  }

  if (type === 'floor_water') {
    return `
      radial-gradient(circle at 25% 20%, rgba(125,211,252,.42), transparent 23%),
      radial-gradient(circle at 70% 70%, rgba(14,165,233,.22), transparent 25%),
      linear-gradient(135deg, #082f49, ${color}, #020617)
    `;
  }

  if (type === 'zone_rect' || type === 'zone_oval') {
    return `
      radial-gradient(circle at 20% 20%, rgba(245,158,11,.10), transparent 30%),
      linear-gradient(135deg, ${color}, #15110d)
    `;
  }

  if (type === 'tree') {
    return `radial-gradient(circle, #22c55e 0%, ${color} 56%, #14532d 100%)`;
  }

  if (type === 'lamp') {
    return `radial-gradient(circle, #fef08a 0%, ${color} 35%, rgba(250,204,21,.25) 58%, transparent 100%)`;
  }

  if (type === 'fireplace') {
    return `radial-gradient(circle, #fde68a 0%, #f97316 35%, ${color} 68%, #450a0a 100%)`;
  }

  if (type === 'bar') {
    return `linear-gradient(135deg, #f59e0b, ${color}, #451a03)`;
  }

  if (type === 'sofa') {
    return `linear-gradient(180deg, ${color}, #450a0a)`;
  }

  if (type === 'chair') {
    return `linear-gradient(180deg, #a16207, ${color})`;
  }

  if (type === 'window') {
    return `linear-gradient(180deg, #7dd3fc, ${color}, #0f172a)`;
  }

  if (type === 'door') {
    return `linear-gradient(180deg, #b45309, ${color}, #451a03)`;
  }

  if (type === 'wall') {
    return `linear-gradient(180deg, #78716c, ${color}, #1c1917)`;
  }

  if (type === 'stone_fence') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 28px, #292524 28px, #292524 34px)`;
  }

  if (type === 'wood_fence') {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 26px, #3f2a14 26px, #3f2a14 32px)`;
  }

  if (type === 'stones') {
    return `radial-gradient(circle at 22% 50%, #a8a29e 0 12px, transparent 13px),
      radial-gradient(circle at 52% 45%, ${color} 0 14px, transparent 15px),
      radial-gradient(circle at 75% 55%, #57534e 0 10px, transparent 11px)`;
  }

  if (type === 'text' || type === 'number') {
    return `${color}`;
  }

  return color;
}

function getObjectText(object: MapObject) {
  const type = String(object.objectType || '');

  if (type === 'tree') return '🌳';
  if (type === 'lamp') return '💡';
  if (type === 'fireplace') return '🔥';
  if (type === 'bar') return object.name || 'Бар';
  if (type === 'sofa') return object.name || 'Диван';
  if (type === 'chair') return object.name || '';
  if (type === 'window') return object.name || '';
  if (type === 'door') return object.name || 'Дверь';
  if (type === 'bridge') return object.name || 'Мост';
  if (type === 'pier') return object.name || 'Причал';
  if (type === 'stones') return '';
  if (type === 'wall' || type === 'stone_fence' || type === 'wood_fence') return object.name || '';
  if (type === 'text' || type === 'number') return object.name || '';

  return object.name || '';
}

function getObjectBorderRadius(objectType: string) {
  if (objectType === 'tree' || objectType === 'lamp' || objectType === 'number') return '999px';
  if (isOvalObject(objectType)) return '999px';
  if (objectType === 'window' || objectType === 'wall' || objectType.includes('fence')) return '12px';
  if (isFloorObject(objectType)) return '28px';
  return '18px';
}

function getObjectShadow(objectType: string, selected: boolean) {
  if (selected) return '0 0 0 3px rgba(251,191,36,.9), 0 18px 30px rgba(0,0,0,.45)';
  if (objectType === 'lamp') return '0 0 34px rgba(250,204,21,.9)';
  if (objectType === 'fireplace') return '0 0 30px rgba(249,115,22,.75)';
  if (isFloorObject(objectType)) return 'inset 0 0 38px rgba(0,0,0,.62), 0 14px 28px rgba(0,0,0,.28)';
  return '0 12px 24px rgba(0,0,0,.45)';
}

function tableColors(table: TableItem, selected: boolean) {
  const status = String(table.status || 'free');

  if (selected) {
    return {
      background: '#f59e0b',
      border: '#fde68a',
      shadow: '0 0 0 3px rgba(251,191,36,.9), 0 0 24px rgba(251,191,36,.85)',
    };
  }

  if (status === 'occupied') {
    return {
      background: '#b91c1c',
      border: '#fca5a5',
      shadow: '0 0 18px rgba(239,68,68,.65)',
    };
  }

  if (status === 'closed' || status === 'hidden') {
    return {
      background: '#525252',
      border: '#a3a3a3',
      shadow: '0 0 12px rgba(115,115,115,.5)',
    };
  }

  if (status === 'reserved' || status === 'booked') {
    return {
      background: '#d97706',
      border: '#fcd34d',
      shadow: '0 0 18px rgba(245,158,11,.65)',
    };
  }

  return {
    background: '#166534',
    border: '#6ee7b7',
    shadow: '0 0 18px rgba(34,197,94,.65)',
  };
}

function Chair({ style }: { style: CSSProperties }) {
  return (
    <span
      style={style}
      className="absolute rounded-md border border-black/50 bg-stone-700 shadow-md"
    />
  );
}

function TableVisual({ table, selected }: { table: TableItem; selected: boolean }) {
  const colors = tableColors(table, selected);
  const isRound = table.shape === 'round';
  const isRect = table.shape === 'rect';

  return (
    <div className="relative h-full w-full overflow-visible">
      <Chair
        style={{
          width: 22,
          height: 12,
          left: '50%',
          top: -13,
          transform: 'translateX(-50%)',
        }}
      />

      <Chair
        style={{
          width: 22,
          height: 12,
          left: '50%',
          bottom: -13,
          transform: 'translateX(-50%)',
        }}
      />

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
          <Chair
            style={{
              width: 12,
              height: 22,
              left: -13,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          />

          <Chair
            style={{
              width: 12,
              height: 22,
              right: -13,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          />
        </>
      )}

      {isRect && (
        <>
          <Chair
            style={{
              width: 12,
              height: 22,
              left: -13,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          />

          <Chair
            style={{
              width: 12,
              height: 22,
              right: -13,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          />
        </>
      )}

      <div
        className="relative z-10 flex h-full w-full items-center justify-center border-2 text-sm font-bold text-white"
        style={{
          background: colors.background,
          borderColor: colors.border,
          boxShadow: colors.shadow,
          borderRadius: isRound ? '999px' : '14px',
        }}
      >
        {table.tableNumber}
      </div>
    </div>
  );
}

export default function ConstructorApp() {
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [zoom, setZoom] = useState(0.48);
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

  function findSelectedItem(): any {
    if (!map || !selected) return null;

    if (selected.kind === 'table') {
      return (map.tables || []).find((item) => String(item.id) === selected.id) || null;
    }

    return (map.objects || []).find((item) => String(item.id) === selected.id) || null;
  }

  function updateLocalItem(kind: ItemKind, id: string, patch: Record<string, unknown>) {
    setMap((current) => {
      if (!current) return current;

      if (kind === 'table') {
        return {
          ...current,
          tables: (current.tables || []).map((item) =>
            String(item.id) === id ? ({ ...item, ...patch } as TableItem) : item,
          ),
        };
      }

      return {
        ...current,
        objects: (current.objects || []).map((item) =>
          String(item.id) === id ? ({ ...item, ...patch } as MapObject) : item,
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
        ? (map.tables || []).find((table) => String(table.id) === id)
        : (map.objects || []).find((object) => String(object.id) === id);

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

  async function createTable(shape: TableShape) {
    setLoading(true);
    setMessage('');

    try {
      const tableNumber = String(((map?.tables || []).length || 0) + 1);
      const width = shape === 'round' ? 96 : shape === 'square' ? 88 : 145;
      const height = shape === 'round' ? 96 : shape === 'square' ? 88 : 82;

      const created = await api.post('/tables', {
        tableNumber,
        seats: 4,
        shape,
        x: 160,
        y: 160,
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

  async function createObject(item: PaletteItem) {
    setLoading(true);
    setMessage('');

    try {
      const created = await api.post('/constructor/objects', {
        objectType: item.objectType,
        name: item.name,
        x: 180,
        y: 180,
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

        if (table.status === 'free') {
          await api.patch(`/tables/${selected.id}/free`);
        }

        if (table.status === 'occupied') {
          await api.patch(`/tables/${selected.id}/occupied`);
        }

        if (table.status === 'closed' || table.status === 'hidden') {
          await api.patch(`/tables/${selected.id}/close`);
        }

        await loadMap();
        setSelected({ kind: 'table', id: selected.id });
      }

      if (selected.kind === 'object') {
        const object = item as MapObject;

        const body = {
          objectType: object.objectType,
          name: object.name || '',
          x: numberValue(object.x),
          y: numberValue(object.y),
          width: numberValue(object.width, 100),
          height: numberValue(object.height, 100),
          rotation: numberValue(object.rotation),
          color: object.color || '#525252',
        };

        try {
          await api.patch(`/constructor/objects/${selected.id}`, body);
          await loadMap();
          setSelected({ kind: 'object', id: selected.id });
        } catch {
          const created = await api.post('/constructor/objects', body);
          const newId = getCreatedId(created);

          try {
            await api.delete(`/constructor/objects/${selected.id}`);
          } catch {}

          await loadMap();

          if (newId) {
            setSelected({ kind: 'object', id: newId });
          } else {
            setSelected(null);
          }
        }
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
          tableNumber: String(table.tableNumber || ''),
          seats: Number(table.seats) || 4,
          shape: table.shape || 'square',
          x: numberValue(table.x) + 40,
          y: numberValue(table.y) + 40,
          width: numberValue(table.width, 90),
          height: numberValue(table.height, 90),
          rotation: numberValue(table.rotation),
        });

        const id = getCreatedId(created);

        await loadMap();

        if (id) {
          setSelected({ kind: 'table', id });
        }
      }

      if (selected.kind === 'object') {
        const object = item as MapObject;

        const created = await api.post('/constructor/objects', {
          objectType: object.objectType,
          name: object.name || '',
          x: numberValue(object.x) + 40,
          y: numberValue(object.y) + 40,
          width: numberValue(object.width, 100),
          height: numberValue(object.height, 100),
          rotation: numberValue(object.rotation),
          color: object.color || '#525252',
        });

        const id = getCreatedId(created);

        await loadMap();

        if (id) {
          setSelected({ kind: 'object', id });
        }
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

  async function clearMap() {
    const ok = window.confirm('Удалить все столы, зоны и объекты с карты?');

    if (!ok) return;

    setLoading(true);
    setMessage('Очищаю карту...');

    try {
      const current = (await mapApi.get()) as FullMapResponse;

      for (const object of current.objects || []) {
        try {
          await api.delete(`/constructor/objects/${object.id}`);
        } catch {}
      }

      for (const table of current.tables || []) {
        try {
          await api.delete(`/tables/${table.id}`);
        } catch {}
      }

      for (const zone of (current as any).zones || []) {
        try {
          await api.delete(`/zones/${zone.id}`);
        } catch {}
      }

      setSelected(null);
      await loadMap();
      setMessage('Карта очищена. Теперь добавляй элементы вручную.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка очистки карты');
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
      setMessage('Карта расширена');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка расширения карты');
    } finally {
      setLoading(false);
    }
  }

  const selectedItem = findSelectedItem();
  const mapWidth = getMapWidth(map);
  const mapHeight = getMapHeight(map);

  const sortedObjects = [...(map?.objects || [])].sort((a, b) => {
    return getObjectLayer(String(a.objectType || '')) - getObjectLayer(String(b.objectType || ''));
  });

  return (
    <div className="mx-auto max-w-md px-4 py-5 pb-28">
      <section className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-black p-5 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">MOLO</p>

        <h1 className="mt-2 text-3xl font-semibold">Конструктор</h1>

        <p className="mt-2 text-sm text-neutral-300">
          Добавляй зоны, покрытия, столы, окна, камин, воду, мост, траву, стены, текст и декор. Всё можно двигать, менять размер, цвет и поворот.
        </p>

        <label className="mt-4 block text-sm text-neutral-300">
          Масштаб: {Math.round(zoom * 100)}%
        </label>

        <input
          type="range"
          min="0.25"
          max="1.1"
          step="0.05"
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
          {FLOOR_ITEMS.map((item) => (
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

        <h2 className="mt-5 text-lg font-semibold">Стены / стройка</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {BUILD_ITEMS.map((item) => (
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

        <h2 className="mt-5 text-lg font-semibold">Мебель / декор / текст</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {FURNITURE_ITEMS.map((item) => (
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

        <button
          disabled={loading}
          onClick={clearMap}
          className="mt-5 w-full rounded-2xl bg-red-500 px-4 py-4 font-semibold text-white disabled:opacity-50"
        >
          Очистить карту
        </button>
      </section>

      {selectedItem && selected && (
        <section className="mt-4 rounded-3xl border border-amber-300/40 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Выбрано</h2>

          <p className="mt-1 text-sm text-neutral-300">
            {selected.kind === 'table' ? 'Стол' : 'Элемент'}
          </p>

          {selected.kind === 'table' && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-neutral-400">
                  Номер
                  <input
                    value={String((selectedItem as TableItem).tableNumber || '')}
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
                    value={Number((selectedItem as TableItem).seats || 1)}
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
                    updateLocalItem(selected.kind, selected.id, {
                      status: 'free',
                    })
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

          {selected.kind === 'object' && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-neutral-400">
                Текст / название
                <input
                  value={String((selectedItem as MapObject).name || '')}
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
                  value={String((selectedItem as MapObject).color || '#525252')}
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
              onClick={duplicateSelected}
              className="rounded-2xl bg-blue-400 px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50"
            >
              <Copy className="mr-1 inline h-4 w-4" />
              Копия
            </button>

            <button
              disabled={loading}
              onClick={deleteSelected}
              className="col-span-2 rounded-2xl bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
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
            Карта: {mapWidth} x {mapHeight}
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
          className="relative h-[700px] overflow-auto rounded-3xl border border-neutral-800 bg-[#0b0a08]"
        >
          <div
            className="relative"
            style={{
              width: mapWidth * zoom,
              height: mapHeight * zoom,
            }}
          >
            <div
              className="relative origin-top-left overflow-hidden rounded-[34px]"
              style={{
                width: mapWidth,
                height: mapHeight,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                background:
                  'radial-gradient(circle at 20% 20%, rgba(245,158,11,.08), transparent 30%), linear-gradient(135deg, #0b0a08, #17120d)',
                backgroundSize: '100% 100%',
              }}
            >
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)',
                  backgroundSize: '50px 50px',
                }}
              />

              {sortedObjects.map((object) => {
                const id = String(object.id);
                const type = String(object.objectType || '');
                const isSelected = selected?.kind === 'object' && selected.id === id;
                const text = getObjectText(object);
                const floor = isFloorObject(type);

                return (
                  <div
                    key={id}
                    onPointerDown={(event) => startDrag(event, 'object', id)}
                    className="absolute flex touch-none select-none items-center justify-center border text-center text-xs font-semibold text-white"
                    style={{
                      left: numberValue(object.x),
                      top: numberValue(object.y),
                      width: numberValue(object.width, 100),
                      height: numberValue(object.height, 100),
                      transform: `rotate(${numberValue(object.rotation)}deg)`,
                      background: getObjectBackground(object),
                      borderRadius: getObjectBorderRadius(type),
                      borderColor: isSelected ? '#fcd34d' : 'rgba(255,255,255,.18)',
                      boxShadow: getObjectShadow(type, isSelected),
                      color: type === 'text' || type === 'number' ? '#ffffff' : '#ffffff',
                      fontSize: type === 'number' ? 28 : floor ? 18 : 13,
                      zIndex: getObjectLayer(type),
                    }}
                  >
                    {text ? (
                      <span className="rounded-full bg-black/30 px-3 py-1 drop-shadow">
                        {text}
                      </span>
                    ) : null}
                  </div>
                );
              })}

              {(map?.tables || []).map((table) => {
                const id = String(table.id);
                const isSelected = selected?.kind === 'table' && selected.id === id;

                return (
                  <div
                    key={id}
                    onPointerDown={(event) => startDrag(event, 'table', id)}
                    className="absolute touch-none select-none"
                    style={{
                      left: numberValue(table.x),
                      top: numberValue(table.y),
                      width: numberValue(table.width, 80),
                      height: numberValue(table.height, 70),
                      transform: `rotate(${numberValue(table.rotation)}deg)`,
                      zIndex: 10,
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
          <span>▦ мрамор</span>
          <span>🌊 вода</span>
          <span>🔥 камин</span>
          <span>▭ окно</span>
          <span>🌳 дерево</span>
          <span>🌉 мост</span>
          <span>🍸 бар</span>
          <span>💡 фонарь</span>
        </div>
      </section>
    </div>
  );
}
