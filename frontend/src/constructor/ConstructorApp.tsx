import { useEffect, useRef, useState } from 'react';
import { Move, Plus, RotateCcw, RotateCw, Save, Trash2 } from 'lucide-react';

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

const DEFAULT_MAP_WIDTH = 1200;
const DEFAULT_MAP_HEIGHT = 900;

const DECOR_ITEMS = [
  {
    label: 'Трава',
    objectType: 'grass',
    name: 'Трава',
    width: 180,
    height: 120,
    color: '#3f7d20',
  },
  {
    label: 'Дерево',
    objectType: 'tree',
    name: 'Дерево',
    width: 80,
    height: 80,
    color: '#2f7d32',
  },
  {
    label: 'Мрамор',
    objectType: 'marble',
    name: 'Мрамор',
    width: 220,
    height: 160,
    color: '#d8d3c7',
  },
  {
    label: 'Вода',
    objectType: 'water',
    name: 'Вода',
    width: 260,
    height: 120,
    color: '#0ea5e9',
  },
  {
    label: 'Мост',
    objectType: 'bridge',
    name: 'Мост',
    width: 220,
    height: 70,
    color: '#8b5a2b',
  },
  {
    label: 'Стена',
    objectType: 'wall',
    name: 'Стена',
    width: 260,
    height: 24,
    color: '#737373',
  },
  {
    label: 'Дверь',
    objectType: 'door',
    name: 'Дверь',
    width: 90,
    height: 28,
    color: '#a16207',
  },
];

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  if (object.objectType === 'marble') return '▦';
  if (object.objectType === 'wall') return '▭';
  if (object.objectType === 'door') return '🚪';
  return object.name || object.objectType;
}

function getObjectBackground(object: MapObject) {
  if (object.objectType === 'water') {
    return 'linear-gradient(135deg, #075985, #38bdf8)';
  }

  if (object.objectType === 'grass') {
    return 'linear-gradient(135deg, #365314, #84cc16)';
  }

  if (object.objectType === 'tree') {
    return 'radial-gradient(circle, #22c55e 0%, #166534 65%, #3f6212 100%)';
  }

  if (object.objectType === 'marble') {
    return 'linear-gradient(135deg, #fafafa, #d4d4d4, #a3a3a3)';
  }

  if (object.objectType === 'bridge') {
    return 'linear-gradient(135deg, #92400e, #f59e0b)';
  }

  if (object.objectType === 'wall') {
    return '#525252';
  }

  if (object.objectType === 'door') {
    return '#92400e';
  }

  return object.color || '#404040';
}

export default function ConstructorApp() {
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [zoom, setZoom] = useState(0.7);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  async function loadMap() {
    const data = await mapApi.get();
    setMap(data);
  }

  useEffect(() => {
    loadMap().catch(() => {
      setMessage('Не удалось загрузить карту');
    });
  }, []);

  function findSelectedItem() {
    if (!map || !selected) return null;

    if (selected.kind === 'table') {
      return map.tables.find((item) => item.id === selected.id) || null;
    }

    if (selected.kind === 'zone') {
      return map.zones.find((item) => item.id === selected.id) || null;
    }

    return map.objects.find((item) => item.id === selected.id) || null;
  }

  function updateLocalItem(kind: ItemKind, id: string, patch: Record<string, unknown>) {
    setMap((current) => {
      if (!current) return current;

      if (kind === 'table') {
        return {
          ...current,
          tables: current.tables.map((item) =>
            item.id === id ? ({ ...item, ...patch } as TableItem) : item,
          ),
        };
      }

      if (kind === 'zone') {
        return {
          ...current,
          zones: current.zones.map((item) =>
            item.id === id ? ({ ...item, ...patch } as Zone) : item,
          ),
        };
      }

      return {
        ...current,
        objects: current.objects.map((item) =>
          item.id === id ? ({ ...item, ...patch } as MapObject) : item,
        ),
      };
    });
  }

  function getPointerPosition(event: React.PointerEvent) {
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

  function startDrag(event: React.PointerEvent, kind: ItemKind, id: string) {
    event.preventDefault();
    event.stopPropagation();

    const currentMap = map;
    if (!currentMap) return;

    const item =
      kind === 'table'
        ? currentMap.tables.find((table) => table.id === id)
        : kind === 'zone'
          ? currentMap.zones.find((zone) => zone.id === id)
          : currentMap.objects.find((object) => object.id === id);

    if (!item) return;

    const point = getPointerPosition(event);

    setSelected({ kind, id });
    setDragging({
      kind,
      id,
      offsetX: point.x - numberValue(item.x),
      offsetY: point.y - numberValue(item.y),
    });

    canvasRef.current?.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent) {
    if (!dragging) return;

    const point = getPointerPosition(event);

    updateLocalItem(dragging.kind, dragging.id, {
      x: Math.round(point.x - dragging.offsetX),
      y: Math.round(point.y - dragging.offsetY),
    });
  }

  function stopDrag(event: React.PointerEvent) {
    if (!dragging) return;

    setDragging(null);
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
    setMessage('Объект передвинут. Нажми "Сохранить выбранное".');
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
        await api.patch(`/constructor/tables/${selected.id}/position`, position);
        await api.patch(`/constructor/tables/${selected.id}/size`, size);
      }

      if (selected.kind === 'zone') {
        await api.patch(`/constructor/zones/${selected.id}/position`, position);
        await api.patch(`/constructor/zones/${selected.id}/size`, size);
      }

      if (selected.kind === 'object') {
        await api.patch(`/constructor/objects/${selected.id}/position`, position);
        await api.patch(`/constructor/objects/${selected.id}/size`, size);
      }

      await loadMap();
      setMessage('Сохранено');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  }

  async function createTable(shape: 'rect' | 'round') {
    setLoading(true);
    setMessage('');

    try {
      const tableNumber = String((map?.tables?.length || 0) + 1);

      const created = await api.post('/tables', {
        tableNumber,
        seats: 4,
        shape,
        x: 80,
        y: 80,
        width: shape === 'round' ? 80 : 110,
        height: shape === 'round' ? 80 : 70,
        rotation: 0,
      });

      await loadMap();
      setSelected({ kind: 'table', id: created.id });
      setMessage(`Добавлен стол ${tableNumber}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка создания стола');
    } finally {
      setLoading(false);
    }
  }

  async function createZone() {
    setLoading(true);
    setMessage('');

    try {
      const created = await api.post('/zones', {
        name: `Зона ${(map?.zones?.length || 0) + 1}`,
        color: '#262626',
        x: 40,
        y: 40,
        width: 420,
        height: 240,
        rotation: 0,
        isVisible: true,
      });

      await loadMap();
      setSelected({ kind: 'zone', id: created.id });
      setMessage('Зона добавлена');
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
        x: 120,
        y: 120,
        width: item.width,
        height: item.height,
        rotation: 0,
        color: item.color,
      });

      await loadMap();
      setSelected({ kind: 'object', id: created.id });
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

  async function expandMap(direction: 'right' | 'bottom' | 'left' | 'top') {
    setLoading(true);
    setMessage('');

    try {
      await api.post('/constructor/map/expand', {
        direction,
        amount: 200,
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
      <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">
          MOLO
        </p>

        <h1 className="mt-2 text-3xl font-semibold">Конструктор залу</h1>

        <p className="mt-2 text-sm text-neutral-300">
          Добавляй столы, зоны и декор. Перетаскивай пальцем. После перемещения нажимай
          сохранить.
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
        <h2 className="text-lg font-semibold">Добавить</h2>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            disabled={loading}
            onClick={() => createTable('rect')}
            className="rounded-2xl bg-amber-300 px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Стол прямой
          </button>

          <button
            disabled={loading}
            onClick={() => createTable('round')}
            className="rounded-2xl bg-amber-300 px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Стол круглый
          </button>

          <button
            disabled={loading}
            onClick={createZone}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm disabled:opacity-50"
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Зона
          </button>

          <button
            disabled={loading}
            onClick={() => expandMap('right')}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm disabled:opacity-50"
          >
            Расширить →
          </button>

          <button
            disabled={loading}
            onClick={() => expandMap('bottom')}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm disabled:opacity-50"
          >
            Расширить ↓
          </button>

          <button
            disabled={loading}
            onClick={() => loadMap()}
            className="rounded-2xl border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm disabled:opacity-50"
          >
            Обновить
          </button>
        </div>

        <h3 className="mt-4 text-sm font-semibold text-neutral-300">Декор</h3>

        <div className="mt-2 grid grid-cols-3 gap-2">
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
      </section>

      {selectedItem && selected && (
        <section className="mt-4 rounded-3xl border border-amber-300/40 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Выбрано</h2>

          <p className="mt-1 text-sm text-neutral-300">
            {selected.kind === 'table' && 'Стол'}
            {selected.kind === 'zone' && 'Зона'}
            {selected.kind === 'object' && 'Декор'}
          </p>

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

          <span className="flex items-center gap-1">
            <Move className="h-3 w-3" />
            двигай пальцем
          </span>
        </div>

        <div
          ref={canvasRef}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          className="relative h-[620px] overflow-auto rounded-3xl border border-neutral-800 bg-[#17140f]"
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
              }}
            >
              {map?.zones?.map((zone) => {
                const isSelected = selected?.kind === 'zone' && selected.id === zone.id;

                return (
                  <div
                    key={zone.id}
                    onPointerDown={(event) => startDrag(event, 'zone', zone.id)}
                    className={`absolute touch-none rounded-3xl border p-3 text-xs text-neutral-200 ${
                      isSelected
                        ? 'border-amber-300 bg-amber-300/10'
                        : 'border-neutral-700 bg-neutral-900/60'
                    }`}
                    style={{
                      left: numberValue(zone.x),
                      top: numberValue(zone.y),
                      width: numberValue(zone.width, 200),
                      height: numberValue(zone.height, 150),
                      transform: `rotate(${numberValue(zone.rotation)}deg)`,
                    }}
                  >
                    {zone.isClosed ? '🔒 ' : ''}
                    {zone.name}
                  </div>
                );
              })}

              {map?.objects?.map((object) => {
                const isSelected =
                  selected?.kind === 'object' && selected.id === object.id;

                return (
                  <div
                    key={object.id}
                    onPointerDown={(event) => startDrag(event, 'object', object.id)}
                    className={`absolute flex touch-none items-center justify-center rounded-2xl border text-center text-xs font-semibold text-white shadow-lg ${
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
                    <span className="px-1">
                      {getObjectLabel(object)}
                      <br />
                      {object.name}
                    </span>
                  </div>
                );
              })}

              {map?.tables?.map((table) => {
                const isSelected =
                  selected?.kind === 'table' && selected.id === table.id;

                return (
                  <button
                    key={table.id}
                    onPointerDown={(event) => startDrag(event, 'table', table.id)}
                    className={`absolute flex touch-none items-center justify-center border text-xs font-bold text-white shadow-lg ${
                      table.shape === 'round' ? 'rounded-full' : 'rounded-xl'
                    } ${
                      isSelected
                        ? 'border-amber-300 bg-amber-500'
                        : table.status === 'free'
                          ? 'border-emerald-300 bg-emerald-500'
                          : 'border-amber-300 bg-amber-600'
                    }`}
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
          <span>🟢 Стол</span>
          <span>▦ Мрамор</span>
          <span>🌊 Вода</span>
          <span>🌿 Трава</span>
          <span>🌳 Дерево</span>
          <span>🌉 Мост</span>
        </div>
      </section>
    </div>
  );
}
