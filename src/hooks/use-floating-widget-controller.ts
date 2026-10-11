import { useEffect, useMemo } from 'react'
import { useFloatingNoteStore } from '../stores/floating-note-store'
import { useFloatingCalendarStore } from '../stores/floating-calendar-store'
import { useFloatingStatusStore } from '../stores/floating-status-store'
import type {
  FloatingCalendar,
  FloatingNote,
  FloatingStatus,
} from '../models'

/**
 * Per-canvas placement controller for the three placement-only floating
 * widget kinds (note / calendar / status). Bundles
 * `loadByCanvas` (auto-fired when `selectedCanvasId` changes), `items`,
 * the three standard handlers (drag-stop / resize / close), and `addAtPosition`
 * so `CanvasPage` doesn't repeat the 5-store-pull + 3-callback wrapper block
 * per kind. The exported hooks are thin per-kind wrappers around the
 * shared `useController` core; identity is preserved (handlers reference the
 * stable Zustand store actions directly).
 *
 * Out of scope:
 *   - List inset (lens) — its `add()` takes a `listDefinitionId` and follows a
 *     different placement contract; consumers continue to pull from
 *     `useListInsetStore` directly.
 *   - Per-kind extras (status `setCollapsed`, calendar `updateOrientation`/
 *     `updateWeekOffset`) — kind-specific; consumers pull from the store
 *     directly when they need them.
 */
export interface FloatingWidgetHandlers {
  onDragStop: (id: number, x: number, y: number) => Promise<void>
  onResize: (id: number, width: number, height: number) => Promise<void>
  onClose: (id: number) => Promise<void>
}

export interface FloatingWidgetController<T> {
  items: T[]
  handlers: FloatingWidgetHandlers
  addAtPosition: (canvasId: number, x: number, y: number) => Promise<number>
}

function useController<T>(
  items: T[],
  loadByCanvas: (canvasId: number) => Promise<void>,
  updatePosition: (id: number, x: number, y: number) => Promise<void>,
  updateSize: (id: number, width: number, height: number) => Promise<void>,
  remove: (id: number) => Promise<void>,
  add: (canvasId: number, x: number, y: number) => Promise<number>,
  selectedCanvasId: number | null,
): FloatingWidgetController<T> {
  useEffect(() => {
    if (selectedCanvasId != null) void loadByCanvas(selectedCanvasId)
  }, [selectedCanvasId, loadByCanvas])

  const handlers = useMemo<FloatingWidgetHandlers>(
    () => ({ onDragStop: updatePosition, onResize: updateSize, onClose: remove }),
    [updatePosition, updateSize, remove],
  )

  return { items, handlers, addAtPosition: add }
}

export function useFloatingNoteController(
  selectedCanvasId: number | null,
): FloatingWidgetController<FloatingNote> {
  return useController<FloatingNote>(
    useFloatingNoteStore((s) => s.notes),
    useFloatingNoteStore((s) => s.loadByCanvas),
    useFloatingNoteStore((s) => s.updatePosition),
    useFloatingNoteStore((s) => s.updateSize),
    useFloatingNoteStore((s) => s.remove),
    useFloatingNoteStore((s) => s.add),
    selectedCanvasId,
  )
}

export function useFloatingCalendarController(
  selectedCanvasId: number | null,
): FloatingWidgetController<FloatingCalendar> {
  return useController<FloatingCalendar>(
    useFloatingCalendarStore((s) => s.calendars),
    useFloatingCalendarStore((s) => s.loadByCanvas),
    useFloatingCalendarStore((s) => s.updatePosition),
    useFloatingCalendarStore((s) => s.updateSize),
    useFloatingCalendarStore((s) => s.remove),
    useFloatingCalendarStore((s) => s.add),
    selectedCanvasId,
  )
}

export function useFloatingStatusController(
  selectedCanvasId: number | null,
): FloatingWidgetController<FloatingStatus> {
  return useController<FloatingStatus>(
    useFloatingStatusStore((s) => s.statuses),
    useFloatingStatusStore((s) => s.loadByCanvas),
    useFloatingStatusStore((s) => s.updatePosition),
    useFloatingStatusStore((s) => s.updateSize),
    useFloatingStatusStore((s) => s.remove),
    useFloatingStatusStore((s) => s.add),
    selectedCanvasId,
  )
}
