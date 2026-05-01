import type { SlotKind } from '../models/canvas-rails'
import type { FloatDragKind } from '../stores/ui-store'
import { useFloatingNoteStore } from '../stores/floating-note-store'
import { useFloatingCalendarStore } from '../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../stores/floating-taskboard-store'
import { useFloatingHorizonsStore } from '../stores/floating-horizons-store'
import { useFloatingStatusStore } from '../stores/floating-status-store'
import { useFloatingScoreboardStore } from '../stores/floating-scoreboard-store'
import { useFloatingSnoozeGraveyardStore } from '../stores/floating-snooze-graveyard-store'
import { useListInsetStore } from '../stores/list-inset-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { listInsetRepository } from '../data'
import { FLOAT_DEFAULT_RECTS } from './float-default-rects'
import type { FloatDescriptor } from '../utils/rail-dnd'

/**
 * Single source of truth for every floating canvas widget kind. Five entries
 * keyed by `slotKind` (the persisted `SlotKind`, with `'notes'` plural for the
 * note kind to match the rails Tab type). Consumers:
 *
 *   - `CanvasView.tsx` — prefix → kind decoding for `handleNodesChange`'s
 *     drag-stop / float-drag publish.
 *   - `CanvasPage.tsx` — `handleFloatDock` builds a `FloatDescriptor` via
 *     `buildDescriptor`.
 *   - `services/float-kind-switch.ts` — `convertFloatingKind` removes the
 *     source row via `remove`.
 *
 * Adding a sixth widget kind: append a new entry here, define the matching
 * floating-* store, and wire the corresponding pop-in / dock paths. Every
 * other consumer iterates this list (no per-kind branches).
 */
export interface FloatKindEntry {
  slotKind: SlotKind
  floatDragKind: FloatDragKind
  domPrefix: string
  /** Human-readable kind label used by the rails / float-drag a11y announcer. */
  label: string
  /** Default float widget dimensions for spawn / pop-out / convert paths. */
  defaultRect: { width: number; height: number }
  /** Remove the floating row by id. Used by `convertFloatingKind` to drop the source row before creating the target-kind row. */
  remove: (id: number) => Promise<void>
  /**
   * Create a fresh floating widget at (x, y). `listDefinitionId` is required
   * for the `'lens'` kind and ignored for other kinds. Used by
   * `convertFloatingKind`.
   */
  addFloat: (opts: { canvasId: number; x: number; y: number; listDefinitionId?: number }) => Promise<number>
  /** Set the float's width/height. Wraps each kind's store-specific update path. */
  setSize: (id: number, width: number, height: number) => Promise<void>
  /**
   * Build a `FloatDescriptor` for `handleFloatDock`. Reads kind-specific fields
   * from the appropriate store (calendar threads `orientation` / `weekOffset`;
   * lens threads `listDefinitionId`; taskboard awaits `ensureLoaded`). Returns
   * `null` when the source row can't be resolved (e.g. taskboard load failed).
   */
  buildDescriptor: (floatId: number) => Promise<FloatDescriptor | null>
}

export const FLOAT_KIND_REGISTRY: readonly FloatKindEntry[] = [
  {
    slotKind: 'lens',
    floatDragKind: 'lens',
    domPrefix: 'inset-',
    label: 'list',
    defaultRect: FLOAT_DEFAULT_RECTS.lens,
    remove: (id) => useListInsetStore.getState().remove(id),
    addFloat: async ({ canvasId, x, y, listDefinitionId }) => {
      if (listDefinitionId == null) {
        throw new Error('floatKindRegistry: lens addFloat requires listDefinitionId')
      }
      return useListInsetStore.getState().add(listDefinitionId, canvasId, x, y)
    },
    setSize: async (id, width, height) => {
      const store = useListInsetStore.getState()
      const inset = store.insets.find((i) => i.id === id)
      if (!inset) return
      await listInsetRepository.update({ ...inset, width, height })
      // Reload because list-inset-store.update writes the whole inset, but we
      // bypass it here to avoid a redundant patch + the store reload picks up
      // the post-write row faithfully.
      await store.loadByCanvas(inset.canvasId)
    },
    buildDescriptor: async (floatId) => {
      const inset = useListInsetStore.getState().insets.find((i) => i.id === floatId)
      if (!inset) return null
      return { kind: 'lens', id: floatId, listDefinitionId: inset.listDefinitionId }
    },
  },
  {
    slotKind: 'notes',
    floatDragKind: 'note',
    domPrefix: 'note-',
    label: 'note',
    defaultRect: FLOAT_DEFAULT_RECTS.notes,
    remove: (id) => useFloatingNoteStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingNoteStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingNoteStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => ({ kind: 'note', id: floatId }),
  },
  {
    slotKind: 'calendar',
    floatDragKind: 'calendar',
    domPrefix: 'calendar-',
    label: 'calendar',
    defaultRect: FLOAT_DEFAULT_RECTS.calendar,
    remove: (id) => useFloatingCalendarStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingCalendarStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingCalendarStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => {
      const cal = useFloatingCalendarStore.getState().calendars.find((c) => c.id === floatId)
      if (!cal) return null
      return {
        kind: 'calendar',
        id: floatId,
        orientation: cal.orientation,
        weekOffset: cal.weekOffset,
      }
    },
  },
  {
    slotKind: 'taskboard',
    floatDragKind: 'taskboard',
    domPrefix: 'taskboard-',
    label: 'taskboard',
    defaultRect: FLOAT_DEFAULT_RECTS.taskboard,
    remove: (id) => useFloatingTaskboardStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingTaskboardStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingTaskboardStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => {
      await useTaskboardStore.getState().ensureLoaded()
      const board = useTaskboardStore.getState().board
      if (!board?.id) {
        console.warn('floatKindRegistry: taskboard still unavailable after ensureLoaded')
        return null
      }
      return { kind: 'taskboard', id: floatId }
    },
  },
  {
    slotKind: 'horizons',
    floatDragKind: 'horizons',
    domPrefix: 'horizons-',
    label: 'horizons',
    defaultRect: FLOAT_DEFAULT_RECTS.horizons,
    remove: (id) => useFloatingHorizonsStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingHorizonsStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingHorizonsStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => ({ kind: 'horizons', id: floatId }),
  },
  {
    slotKind: 'status',
    floatDragKind: 'status',
    domPrefix: 'status-',
    label: 'open by status',
    defaultRect: FLOAT_DEFAULT_RECTS.status,
    remove: (id) => useFloatingStatusStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingStatusStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingStatusStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => ({ kind: 'status', id: floatId }),
  },
  {
    slotKind: 'scoreboard',
    floatDragKind: 'scoreboard',
    domPrefix: 'scoreboard-',
    label: 'discipline scoreboard',
    defaultRect: FLOAT_DEFAULT_RECTS.scoreboard,
    remove: (id) => useFloatingScoreboardStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingScoreboardStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingScoreboardStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => ({ kind: 'scoreboard', id: floatId }),
  },
  {
    slotKind: 'snoozeGraveyard',
    floatDragKind: 'snoozeGraveyard',
    domPrefix: 'snooze-graveyard-',
    label: 'snooze graveyard',
    defaultRect: FLOAT_DEFAULT_RECTS.snoozeGraveyard,
    remove: (id) => useFloatingSnoozeGraveyardStore.getState().remove(id),
    addFloat: ({ canvasId, x, y }) => useFloatingSnoozeGraveyardStore.getState().add(canvasId, x, y),
    setSize: (id, width, height) => useFloatingSnoozeGraveyardStore.getState().updateSize(id, width, height),
    buildDescriptor: async (floatId) => ({ kind: 'snoozeGraveyard', id: floatId }),
  },
] as const

const BY_SLOT_KIND = new Map<SlotKind, FloatKindEntry>(
  FLOAT_KIND_REGISTRY.map((e) => [e.slotKind, e]),
)

const BY_DRAG_KIND = new Map<FloatDragKind, FloatKindEntry>(
  FLOAT_KIND_REGISTRY.map((e) => [e.floatDragKind, e]),
)

export function floatKindBySlotKind(kind: SlotKind): FloatKindEntry {
  const entry = BY_SLOT_KIND.get(kind)
  if (!entry) throw new Error(`floatKindBySlotKind: unknown SlotKind ${kind}`)
  return entry
}

export function floatKindByDragKind(kind: FloatDragKind): FloatKindEntry {
  const entry = BY_DRAG_KIND.get(kind)
  if (!entry) throw new Error(`floatKindByDragKind: unknown FloatDragKind ${kind}`)
  return entry
}

/**
 * Decode a React Flow node id into its `FloatDragKind`, numeric id, and
 * registry entry. Returns `null` when the id identifies a non-float node (e.g.
 * a project). Used by `CanvasView.handleNodesChange` to route drag-stop frames
 * + flip the `floatDrag` slice on `ui-store`.
 */
export function floatKindForNodeId(id: string): { kind: FloatDragKind; floatId: number; entry: FloatKindEntry } | null {
  for (const entry of FLOAT_KIND_REGISTRY) {
    if (id.startsWith(entry.domPrefix)) {
      const floatId = Number(id.slice(entry.domPrefix.length))
      if (Number.isFinite(floatId)) return { kind: entry.floatDragKind, floatId, entry }
    }
  }
  return null
}

/** True iff the id is the React Flow node id of any floating canvas widget. */
export function isFloatNodeId(id: string): boolean {
  return floatKindForNodeId(id) !== null
}
