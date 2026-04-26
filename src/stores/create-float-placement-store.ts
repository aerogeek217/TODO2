import { mutate, optimistic, updateItemInList, type SetFn } from './store-helpers'
import { undoable } from '../services/undoable'
import { clampCanvasPosition } from '../utils/canvas-bounds'

/**
 * Shared shape for the four floating placement-only widgets (note, calendar,
 * taskboard, horizons). Each row carries x/y/w/h on a canvas; widget content
 * lives elsewhere (a global note, the singleton taskboard, settings-driven
 * horizons, etc.). list-inset has a sufficiently different shape (`add` takes
 * `listDefinitionId` + bespoke `update`) that it's NOT factory-built — see
 * `list-inset-store.ts` directly.
 */
export interface FloatPlacement {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
}

/** Repository surface required by `createFloatPlacementMethods`. */
export interface FloatPlacementRepo<T extends FloatPlacement> {
  getByCanvas: (canvasId: number) => Promise<T[]>
  getById: (id: number) => Promise<T | undefined>
  insert: (row: Omit<T, 'id'>) => Promise<number>
  update: (row: T) => Promise<void>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

/** Methods returned by the factory. Each store composes these onto its own state shape. */
export interface FloatPlacementMethods<T extends FloatPlacement> {
  loadByCanvas: (canvasId: number) => Promise<void>
  add: (canvasId: number, x: number, y: number, extra?: Partial<T>) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

export interface FloatPlacementFactoryOpts<T extends FloatPlacement> {
  repo: FloatPlacementRepo<T>
  defaults: { width: number; height: number }
  /** State property name that holds the row list (e.g. `'notes'`, `'calendars'`). */
  slice: string
  /** Human label used in error / undo strings (e.g. `'floating note'`). */
  label: string
  /** Undo description used by the `remove` undo entry (e.g. `'Close floating note'`). */
  removeUndoLabel: string
}

/**
 * Build the five canonical methods for a placement-only floating widget store.
 * Each store wires `set` + `get` from its `create<T>(...)` callback and
 * spreads the returned methods alongside its initial state, layering kind-
 * specific extension methods (calendar's `updateOrientation` /
 * `updateWeekOffset`; taskboard / horizons `setCollapsed`) on top.
 *
 * The `slice` opt picks the state property that holds the row list. Methods
 * read/write that property via untyped lookup against the partial-state shape
 * `{ [slice]: T[], loading, error }`.
 */
export function createFloatPlacementMethods<T extends FloatPlacement>(
  opts: FloatPlacementFactoryOpts<T>,
  set: SetFn,
  get: () => unknown,
): FloatPlacementMethods<T> {
  const { repo, defaults, slice, label, removeUndoLabel } = opts
  const list = (): T[] => ((get() as Record<string, unknown>)[slice] as T[] | undefined) ?? []
  const setList = (next: T[]) => set({ [slice]: next })

  const methods: FloatPlacementMethods<T> = {
    async loadByCanvas(canvasId) {
      set({ loading: true, error: null })
      try {
        const rows = await repo.getByCanvas(canvasId)
        set({ [slice]: rows })
      } catch (e) {
        console.error(`Failed to load ${label}:`, e)
        set({ error: `Failed to load ${label}` })
      } finally {
        set({ loading: false })
      }
    },

    async add(canvasId, x, y, extra) {
      return mutate(set, async () => {
        const clamped = clampCanvasPosition(x, y)
        const seedRow = {
          canvasId,
          x: clamped.x,
          y: clamped.y,
          width: defaults.width,
          height: defaults.height,
          ...(extra ?? {}),
        } as Omit<T, 'id'>
        const id = await repo.insert(seedRow)
        const row = await repo.getById(id)
        if (row) setList([...list(), row])
        return id
      }, `Failed to add ${label}`)
    },

    async updatePosition(id, x, y) {
      const prev = list().find((r) => r.id === id)
      if (!prev) return
      const { x: cx, y: cy } = clampCanvasPosition(x, y)
      return optimistic(
        set,
        () => setList(updateItemInList(list(), id, { x: cx, y: cy } as Partial<T>)),
        () => repo.updatePosition(id, cx, cy),
        () => setList(updateItemInList(list(), id, { x: prev.x, y: prev.y } as Partial<T>)),
        `Failed to update ${label} position`,
      )
    },

    async updateSize(id, width, height) {
      const prev = list().find((r) => r.id === id)
      if (!prev) return
      return optimistic(
        set,
        () => setList(updateItemInList(list(), id, { width, height } as Partial<T>)),
        () => repo.update({ ...prev, width, height }),
        () => setList(updateItemInList(list(), id, { width: prev.width, height: prev.height } as Partial<T>)),
        `Failed to update ${label} size`,
      )
    },

    async remove(id) {
      return mutate(set, async () => {
        const row = list().find((r) => r.id === id)
        await repo.remove(id)
        setList(list().filter((r) => r.id !== id))
        if (row) {
          undoable(
            removeUndoLabel,
            () => methods.remove(id),
            async () => {
              await repo.insert(row as Omit<T, 'id'>)
              setList([...list(), row])
            },
            true,
          )
        }
      }, `Failed to delete ${label}`)
    },
  }

  return methods
}

/**
 * Build a `setCollapsed(id, collapsed)` extension method. Used by the
 * floating-taskboard and floating-horizons stores; not in the base factory
 * because note + calendar don't have a collapsed flag.
 */
export function createSetCollapsed<T extends FloatPlacement & { collapsed?: boolean }>(
  opts: { repo: FloatPlacementRepo<T>; slice: string; label: string },
  set: SetFn,
  get: () => unknown,
): (id: number, collapsed: boolean) => Promise<void> {
  const { repo, slice, label } = opts
  const list = (): T[] => ((get() as Record<string, unknown>)[slice] as T[] | undefined) ?? []
  const setList = (next: T[]) => set({ [slice]: next })

  return async (id, collapsed) => {
    const prev = list().find((r) => r.id === id)
    if (!prev) return
    return optimistic(
      set,
      () => setList(updateItemInList(list(), id, { collapsed } as Partial<T>)),
      () => repo.update({ ...prev, collapsed }),
      () => setList(updateItemInList(list(), id, { collapsed: prev.collapsed } as Partial<T>)),
      `Failed to update ${label}`,
    )
  }
}
