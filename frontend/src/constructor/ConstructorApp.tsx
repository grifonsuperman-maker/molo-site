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
  { tableNumber: '
