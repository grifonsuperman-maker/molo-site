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

type TemplateZone = {
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  isVisible?: boolean;
};

const DEFAULT_MAP_WIDTH = 1800;
const DEFAULT_MAP_HEIGHT = 1200;

const ZONE_PRESETS = [
  { label: 'Зал', name: 'Основний зал', color: '#2b261f', width: 520, height: 320 },
  { label: 'Мрамор', name: 'Мраморна плитка', color: '#d8d3c7', width: 520, height: 320 },
  { label: 'Плитка', name: 'Плитка', color: '#78716c', width: 520, height: 320 },
  { label: 'Тротуар', name: 'Тротуарна плитка', color: '#57534e', width: 520, height: 220 },
  { label: 'Газон', name: 'Газон', color: '#3f6212', width: 520, height: 320 },
  { label: 'Вода', name: 'Вода', color: '#075985', width: 520, height: 260 },
  { label: 'Тераса', name: 'Деревʼяна тераса', color: '#7c4a1e', width: 520, height: 280 },
];

const DECOR_ITEMS = [
  { label: 'Мрамор', objectType: 'marble_tile', name: 'Мрамор', width: 260, height: 180, color: '#ded8c8' },
  { label: 'Плитка', objectType: 'tile', name: 'Плитка', width: 260, height: 180, color: '#78716c' },
  { label: 'Тротуар', objectType: 'pavement', name: 'Тротуар', width: 280, height: 130, color: '#57534e' },
  { label: 'Газон', objectType: 'grass', name: 'Газон', width: 240, height: 160, color: '#3f7d20' },
  { label: 'Вода', objectType: 'water', name: 'Вода', width: 320, height: 160, color: '#0ea5e9' },
  { label: 'Дерево', objectType: 'tree', name: 'Дерево', width: 90, height: 90, color: '#166534' },
  { label: 'Камни', objectType: 'stones', name: 'Камни', width: 130, height: 70, color: '#71717a' },
  { label: 'Фонарь', objectType: 'lamp', name: 'Фонарь', width: 58, height: 92, color: '#facc15' },
  { label: 'Мост', objectType: 'bridge', name: 'Мост', width: 270, height: 85, color: '#8b5a2b' },
  { label: 'Причал', objectType: 'pier', name: 'Причал', width: 300, height: 120, color: '#7c4a1e' },
  { label: 'Бар', objectType: 'bar', name: 'Бар', width: 330, height: 95, color: '#713f12' },
  { label: 'Диван', objectType: 'sofa', name: 'Диван', width: 190, height: 75, color: '#7f1d1d' },
  { label: 'Стул', objectType: 'chair', name: 'Стул', width: 55, height: 55, color: '#92400e' },
  { label: 'Камин', objectType: 'fireplace', name: 'Камин', width: 135, height: 85, color: '#dc2626' },
  { label: 'Окно', objectType: 'window', name: 'Окно', width: 150, height: 34, color: '#38bdf8' },
  { label: 'Дверь', objectType: 'door', name: 'Дверь', width: 100, height: 36, color: '#92400e' },
  { label: 'Стена', objectType: 'wall', name: 'Стена', width: 320, height: 30, color: '#525252' },
  { label: 'Забор кам.', objectType: 'stone_fence', name: 'Каменный забор', width: 280, height: 40, color: '#78716c' },
  { label: 'Забор дер.', objectType: 'wood_fence', name: 'Деревянный забор', width: 280, height: 40, color: '#854d0e' },
  { label: 'Надпись', objectType: 'text', name: 'Текст', width: 210, height: 55, color: '#111827' },
];

const TEMPLATE_ZONES: TemplateZone[] = [
  { name: 'Банкетний зал', color: '#2d2924', x: 70, y: 60, width: 830, height: 260 },
  { name: 'Основний зал', color: '#312d27', x: 70, y: 355, width: 720, height: 520 },
  { name: 'Бар', color: '#2b2119', x: 80, y: 820, width: 310, height: 210 },
  { name: 'Деревʼяна тераса', color: '#7c4a1e', x: 850, y: 360, width: 420, height: 560 },
  { name: 'Вода', color: '#075985', x: 1290, y: 40, width: 440, height: 960 },
  { name: 'Причал', color: '#7c4a1e', x: 1340, y: 110, width: 310, height: 410 },
  { name: 'Мост', color: '#8b5a2b', x: 1330, y: 585, width: 320, height: 150 },
];

const TEMPLATE_OBJECTS: TemplateObject[] = [
  { objectType: 'wall', name: 'Стена', x: 55, y: 45, width: 860, height: 24, color: '#5b5248' },
  { objectType: 'wall', name: 'Стена', x: 55, y: 320, width: 860, height: 24, color: '#5b5248' },
  { objectType: 'wall', name: 'Стена', x: 55, y: 45, width: 24, height: 300, color: '#5b5248' },
  { objectType: 'wall', name: 'Стена', x: 900, y: 45, width: 24, height: 300, color: '#5b5248' },

  { objectType: 'wall', name: 'Стена', x: 55, y: 340, width: 740, height: 24, color: '#5b5248' },
  { objectType: 'wall', name: 'Стена', x: 55, y: 875, width: 740, height: 24, color: '#5b5248' },
  { objectType: 'wall', name: 'Стена', x: 55, y: 340, width: 24, height: 560, color: '#5b5248' },
  { objectType: 'wall', name: 'Стена', x: 790, y: 340, width: 24, height: 560, color: '#5b5248' },

  { objectType: 'window', name: 'Окно', x: 95, y: 52, width: 170, height: 30, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 320, y: 52, width: 170, height: 30, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 555, y: 52, width: 170, height: 30, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 70, y: 430, width: 30, height: 170, color: '#38bdf8' },
  { objectType: 'window', name: 'Окно', x: 70, y: 625, width: 30, height: 170, color: '#38bdf8' },

  { objectType: 'door', name: 'Вхід', x: 35, y: 160, width: 45, height: 120, color: '#92400e' },
  { objectType: 'door', name: 'Вхід', x: 35, y: 520, width: 45, height: 120, color: '#92400e' },

  { objectType: 'bar', name: 'Барна стойка', x: 100, y: 855, width: 260, height: 115, color: '#713f12' },
  { objectType: 'fireplace', name: 'Камин', x: 520, y: 500, width: 150, height: 95, color: '#dc2626' },

  { objectType: 'bridge', name: 'Мост', x: 1325, y: 610, width: 335, height: 95, color: '#8b5a2b' },
  { objectType: 'pier', name: 'Причал', x: 1360, y: 145, width: 270, height: 350, color: '#7c4a1e' },

  { objectType: 'tree', name: 'Дерево', x: 945, y: 315, width: 90, height: 90, color: '#166534' },
  { objectType: 'tree', name: 'Дерево', x: 1210, y: 390, width: 90, height: 90, color: '#166534' },
  { objectType: 'tree', name: 'Дерево', x: 1170, y: 720, width: 90, height: 90, color: '#166534' },
  { objectType: 'tree', name: 'Дерево', x: 20, y: 760, width: 80, height: 80, color: '#166534' },

  { objectType: 'lamp', name: 'Фонарь', x: 125, y: 330, width: 46, height: 70, color: '#facc15' },
  { objectType: 'lamp', name: 'Фонарь', x: 760, y: 330, width: 46, height: 70, color: '#facc15' },
  { objectType: 'lamp', name: 'Фонарь', x: 1280, y: 520, width: 46, height: 70, color: '#facc15' },
  { objectType: 'lamp', name: 'Фонарь', x: 1655, y: 520, width: 46, height: 70, color: '#facc15' },

  { objectType: 'text', name: 'Банкетний зал', x: 410, y: 175, width: 260, height: 50, color: '#111827' },
  { objectType: 'text', name: 'Основний зал', x: 350, y: 490, width: 260, height: 50, color: '#111827' },
  { objectType: 'text', name: 'Причал', x: 1410, y: 260, width: 190, height: 50, color: '#111827' },
  { objectType: 'text', name: 'Мост', x: 1390, y: 635, width: 170, height: 50, color: '#111827' },
];

const TEMPLATE_TABLES: TemplateTable[] = [
  { tableNumber: '28', seats: 4, shape: 'rect', x: 180, y: 95, width: 90, height: 66 },
  { tableNumber: '29', seats: 4, shape: 'rect', x: 320, y: 95, width: 90, height: 66 },
  { tableNumber: '30', seats: 4, shape: 'rect', x: 465, y: 95, width: 90, height: 66 },
  { tableNumber: '31', seats: 4, shape: 'rect', x: 605, y: 95, width: 90, height: 66 },
  { tableNumber: '32', seats: 4, shape: 'rect', x: 745, y: 95, width: 90, height: 66 },
  { tableNumber: '33', seats: 4, shape: 'rect', x: 845, y: 95, width: 90, height: 66 },

  { tableNumber: '21', seats: 4, shape: 'square', x: 170, y: 230, width: 78, height: 78 },
  { tableNumber: '22', seats: 4, shape: 'square', x: 315, y: 230, width: 78, height: 78 },
  { tableNumber: '23', seats: 4, shape: 'square', x: 455, y: 230, width: 78, height: 78 },
  { tableNumber: '24', seats: 4, shape: 'square', x: 625, y: 230, width: 78, height: 78 },
  { tableNumber: '25', seats: 4, shape: 'square', x: 760, y: 230, width: 78, height: 78 },
  { tableNumber: '26', seats: 4, shape: 'square', x: 895, y: 230, width: 78, height: 78 },

  { tableNumber: '2', seats: 4, shape: 'square', x: 155, y: 420, width: 78, height: 78 },
  { tableNumber: '4', seats: 4, shape: 'square', x: 300, y: 420, width: 78, height: 78 },
  { tableNumber: '1', seats: 4, shape: 'square', x: 495, y: 420, width: 78, height: 78 },
  { tableNumber: '1', seats: 4, shape: 'square', x: 635, y: 420, width: 78, height: 78 },

  { tableNumber: '5', seats: 6, shape: 'round', x: 175, y: 580, width: 100, height: 100 },
  { tableNumber: '6', seats: 6, shape: 'round', x: 370, y: 580, width: 100, height: 100 },
  { tableNumber: '7', seats: 6, shape: 'round', x: 570, y: 580, width: 100, height: 100 },
  { tableNumber: '8', seats: 6, shape: 'round', x: 175, y: 725, width: 100, height: 100 },
  { tableNumber: '9', seats: 6, shape: 'round', x: 370, y: 725, width: 100, height: 100 },
  { tableNumber: '10', seats: 6, shape: 'round', x: 570, y: 725, width: 100, height: 100 },

  { tableNumber: '11', seats: 4, shape: 'square', x: 360, y: 900, width: 78, height: 78 },
  { tableNumber: '12', seats: 4, shape: 'square', x: 480, y: 900, width: 78, height: 78 },
  { tableNumber: '13', seats: 4, shape: 'square', x: 600, y: 900, width: 78, height: 78 },
  { tableNumber: '14', seats: 4, shape: 'square', x: 720, y: 900, width: 78, height: 78 },

  { tableNumber: '15', seats: 4, shape: 'square', x: 890, y: 470, width: 78, height: 78 },
  { tableNumber: '18', seats: 4, shape: 'square', x: 1020, y: 470, width: 78, height: 78 },
  { tableNumber: '16', seats: 4, shape: 'square', x: 890, y: 610, width: 78, height: 78 },
  { tableNumber: '19', seats: 4, shape: 'square', x: 1020, y: 610, width: 78, height: 78 },
  { tableNumber: '17', seats: 4, shape: 'square', x: 890, y: 750, width: 78, height: 78 },
  { tableNumber: '20', seats: 4, shape: 'square', x: 1020, y: 750, width: 78, height: 78 },

  { tableNumber: '37', seats: 6, shape: 'round', x: 1175, y: 420, width: 105, height: 105 },
  { tableNumber: '38', seats: 6, shape: 'round', x: 1175, y: 600, width: 105, height: 105 },
  { tableNumber: '39', seats: 6, shape: 'round', x: 1175, y: 790, width: 105, height: 105 },

  { tableNumber: '201', seats: 4, shape: 'square', x: 1440, y: 70, width: 82, height: 82 },
  { tableNumber: '29', seats: 4, shape: 'square', x: 1490, y: 190, width: 78, height: 78 },
  { tableNumber: '30', seats: 4, shape: 'square', x: 1490, y: 300, width: 78, height: 78 },
  { tableNumber: '31', seats: 4, shape: 'square', x: 1490, y: 410, width: 78, height: 78 },
  { tableNumber: '32', seats: 4, shape: 'square', x: 1490, y: 520, width: 78, height: 78 },
  { tableNumber: '33', seats: 4, shape: 'square', x: 1490, y: 630, width: 78, height: 78 },
  { tableNumber: '202', seats: 4, shape: 'square', x: 1490, y: 745, width: 82, height: 82 },
  { tableNumber: '41', seats: 4, shape: 'square', x: 1490, y: 865, width: 78, height: 78 },
  { tableNumber: '42', seats: 4, shape: 'square', x: 1490, y: 970, width: 78, height: 78 },
];

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCreatedId(value: unknown) {
  const data = value as any;
  return String(data?.id || data?.data?.id || data?.data?.data?.id || '');
}

function getMapSize(map: FullMapResponse | null) {
  return {
    width: numberValue(map?.restaurant?.mapWidth, DEFAULT_MAP_WIDTH),
    height: numberValue(map?.restaurant?.mapHeight, DEFAULT_MAP_HEIGHT),
  };
}

function getZoneBackground(zone: Zone) {
  const name = `${zone.name || ''}`.toLowerCase();
  const color = zone.color || '#262626';

  if (name.includes('мрамор')) {
    return `linear-gradient(135deg, #f7f3ea, ${color}, #aaa197)`;
  }

  if (name.includes('тротуар')) {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 22px, #292524 22px, #292524 28px)`;
  }

  if (name.includes('плит')) {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 20px, #44403c 20px, #44403c 38px)`;
  }

  if (name.includes('газон') || name.includes('трава')) {
    return `repeating-linear-gradient(45deg, ${color}, ${color} 12px, #65a30d 12px, #65a30d 20px)`;
  }

  if (name.includes('вода')) {
    return `radial-gradient(circle at 35% 20%, rgba(125,211,252,0.35), transparent 22%), linear-gradient(135deg, #082f49, ${color}, #020617)`;
  }

  if (name.includes('терас') || name.includes('дерев') || name.includes('причал') || name.includes('мост')) {
    return `repeating-linear-gradient(90deg, ${color}, ${color} 24px, #3f2a14 24px, #3f2a14 30px)`;
  }

  return `radial-gradient(circle at 10% 15%, rgba(245,158,11,0.08), transparent 30%), ${color}`;
}

function getObjectLabel(object: MapObject) {
  if (object.objectType === 'grass') return '🌿';
  if (object.objectType === 'tree') return '🌳';
  if (object.objectType === 'water') return '🌊';
  if (object.objectType === 'bridge') return '🌉';
  if (object.objectType === 'pier') return '▤';
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
  if (object.objectType === 'wall') return '';
  if (object.objectType === 'door') return '🚪';
  if (object.objectType === 'text') return '';

  return object.name || object.objectType;
}

function getObjectBackground(object: MapObject) {
  const color = object.color || '#404040';

  if (object.objectType === 'water') {
    return `radial-gradient(circle at 35% 25%, rgba(125,211,252,0.5), transparent 22%), linear-gradient(135deg, ${color}, #38bdf8, #075985)`;
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

  if (object.objectType === 'bridge' || object.objectType === 'pier') {
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

  if (object.objectType === 'wall') {
    return `linear-gradient(180deg, #78716c, ${color}, #1c1917)`;
  }

  if (object.objectType === 'text') {
    return 'rgba(0,0,0,0.55)';
  }

  return color;
}

function getTableColors(table: TableItem, selected: boolean) {
  const status = String(table.status || 'free');

  if (selected) {
    return {
      border: 'border-amber-200',
      bg: 'bg-amber-500',
      glow: 'shadow-[0_0_26px_rgba(251,191,36,0.75)]',
    };
  }

  if (status === 'occupied') {
    return {
      border: 'border-red-300',
      bg: 'bg-red-700',
      glow: 'shadow-[0_0_18px_rgba(239,68,68,0.55)]',
    };
  }

  if (status === 'closed' || status === 'hidden') {
    return {
      border: 'border-neutral-400',
      bg: 'bg-neutral-700',
      glow: 'shadow-[0_0_14px_rgba(115,115,115,0.4)]',
    };
  }

  if (status === 'reserved' || status === 'booked') {
    return {
      border: 'border-amber-300',
      bg: 'bg-amber-600',
      glow: 'shadow-[0_0_18px_rgba(245,158,11,0.55)]',
    };
  }

  return {
    border: 'border-emerald-300',
    bg: 'bg-green-800',
    glow: 'shadow-[0_0_18px_rgba(34,197,94,0.55)]',
  };
}

function Chair({ className }: { className: string }) {
  return (
    <span
      className={`absolute rounded-md border border-black/40 bg-stone-700 shadow-md ${className}`}
    />
  );
}

function TableVisual({
  table,
  selected,
}: {
  table: TableItem;
  selected: boolean;
}) {
  const colors = getTableColors(table, selected);
  const isRound = table.shape === 'round';
  const isRect = table.shape === 'rect';

  return (
    <div className="relative h-full w-full overflow-visible">
      <Chair className="left-1/2 top-[-13px] h-15 w-9 -translate-x-1/2" />
      <Chair className="bottom-[-13px] left-1/2 h-15 w-9 -translate-x-1/2" />

      {!isRect && (
        <>
          <Chair className="left-[-13px] top-1/2 h-9 w-15 -translate-y-1/2" />
          <Chair className="right-[-13px] top-1/2 h-9 w-15 -translate-y-1/2" />
        </>
      )}

      {isRect && (
        <>
          <Chair className="left-[15%] top-[-13px] h-15 w-9" />
          <Chair className="right-[15%] top-[-13px] h-15 w-9" />
          <Chair className="bottom-[-13px] left-[15%] h-15 w-9" />
          <Chair className="bottom-[-13px] right-[15%] h-15 w-9" />
        </>
      )}

      <div
        className={`relative flex h-full w-full items-center justify-center border-2 text-sm font-bold text-white ${colors.border} ${colors.bg} ${colors.glow} ${
          isRound ? 'rounded-full' : 'rounded-xl'
        }`}
      >
        <span className="drop-shadow-lg">{table.tableNumber}</span>
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

  async function createTable(shape: TableShape) {
    setLoading(true);
    setMessage('');

    try {
      const tableNumber = String(((map?.tables || []).length || 0) + 1);
      const width = shape === 'round' ? 96 : shape === 'square' ? 88 : 140;
      const height = shape === 'round' ? 96 : shape === 'square' ? 88 : 82;

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
        x: 80,
        y: 80,
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
        x: 150,
        y: 150,
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

  async function createBeautifulTemplate() {
    setLoading(true);
    setMessage('Создаю красивую карту. Подожди, не нажимай кнопки...');

    try {
      for (const zone of TEMPLATE_ZONES) {
        await api.post('/zones', {
          ...zone,
          rotation: zone.rotation || 0,
          isVisible: zone.isVisible ?? true,
        });
      }

      for (const object of TEMPLATE_OBJECTS) {
        await api.post('/constructor/objects', {
          ...object,
          rotation: object.rotation || 0,
        });
      }

      for (const table of TEMPLATE_TABLES) {
        await api.post('/tables', {
          ...table,
          rotation: table.rotation || 0,
        });
      }

      await loadMap();
      setSelected(null);
      setMessage('Красивая карта создана. Теперь можно двигать, менять размеры и сохранять.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания красивой карты');
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
          tableNumber: `${table.tableNumber}-копія`,
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

        if (id) {
          setSelected({ kind: 'table', id });
        }
      }

      if (selected.kind === 'zone') {
        const zone = item as Zone;

        const created = await api.post('/zones', {
          name: `${zone.name} копія`,
          color: zone.color || '#262626',
          x: numberValue(zone.x) + 35,
          y: numberValue(zone.y) + 35,
          width: numberValue(zone.width, 300),
          height: numberValue(zone.height, 200),
          rotation: numberValue(zone.rotation),
          isVisible: true,
        });

        const id = getCreatedId(created);

        await loadMap();

        if (id) {
          setSelected({ kind: 'zone', id });
        }
      }

      if (selected.kind === 'object') {
        const object = item as MapObject;

        const created = await api.post('/constructor/objects', {
          objectType: object.objectType,
          name: `${object.name || object.objectType} копія`,
          x: numberValue(object.x) + 35,
          y: numberValue(object.y) + 35,
          width: numberValue(object.width, 100),
          height: numberValue(object.height, 100),
          rotation: numberValue(object.rotation),
          color: object.color || '#404040',
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
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">MOLO</p>

        <h1 className="mt-2 text-3xl font-semibold">Конструктор залу</h1>

        <p className="mt-2 text-sm text-neutral-300">
          Строй красивую карту ресторана сверху: столы, зоны, мрамор, вода, мост,
          окна, камин, бар, деревья, фонари и декор.
        </p>

        <button
          disabled={loading}
          onClick={createBeautifulTemplate}
          className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-4 font-semibold text-neutral-950 disabled:opacity-50"
        >
          <Sparkles className="mr-2 inline h-5 w-5" />
          Создать красивую карту
        </button>

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
                      ? String((selectedItem as Zone).name || '')
                      : String((selectedItem as MapObject).name || '')
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
                      ? String((selectedItem as Zone).color || '#262626')
                      : String((selectedItem as MapObject).color || '#404040')
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
                  'radial-gradient(circle at 20% 20%, rgba(245,158,11,0.08), transparent 30%), linear-gradient(135deg, #0c0a07, #21170f)',
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
                    <span className="rounded-full bg-black/45 px-3 py-1">
                      {zone.isClosed ? '🔒 ' : ''}
                      {zone.name}
                    </span>
                  </div>
                );
              })}

              {(map?.objects || []).map((object) => {
                const isSelected =
                  selected?.kind === 'object' && selected.id === object.id;

                const isWall = object.objectType === 'wall';
                const isText = object.objectType === 'text';

                return (
                  <div
                    key={object.id}
                    onPointerDown={(event) => startDrag(event, 'object', object.id)}
                    className={`absolute flex touch-none items-center justify-center border text-center text-xs font-semibold text-white shadow-[0_12px_24px_rgba(0,0,0,0.45)] ${
                      isSelected ? 'border-amber-300' : 'border-white/20'
                    } ${isWall ? 'rounded-md' : 'rounded-2xl'}`}
                    style={{
                      left: numberValue(object.x),
                      top: numberValue(object.y),
                      width: numberValue(object.width, 80),
                      height: numberValue(object.height, 80),
                      transform: `rotate(${numberValue(object.rotation)}deg)`,
                      background: getObjectBackground(object),
                    }}
                  >
                    {!isWall && (
                      <span className="px-1 drop-shadow">
                        {getObjectLabel(object)}
                        {isText ? '' : <br />}
                        {object.name}
                      </span>
                    )}
                  </div>
                );
              })}

              {(map?.tables || []).map((table) => {
                const isSelected =
                  selected?.kind === 'table' && selected.id === table.id;

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
