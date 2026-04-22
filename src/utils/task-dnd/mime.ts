/**
 * Native HTML5 drag MIME used by calendar strip / view rows when they drop
 * onto the taskboard. Defined once so `CalendarStrip` and
 * `useExternalTaskboardDrop` read the same constant (F10 in the DnD audit —
 * today each file re-declares a private copy).
 *
 * The payload written under this MIME is a JSON `{ kind: 'todo', todoId }`
 * object; `text/plain` is also written so a drop can fall back to parsing the
 * raw number. Phase 7 of the DnD unification plan retires native HTML5 in
 * favor of dnd-kit across calendar surfaces; this constant vanishes at that
 * point.
 */
export const DRAG_MIME = 'application/x-todo-drag'

/** Serialized payload carried under `DRAG_MIME`. */
export interface TodoDragPayload {
  kind: 'todo'
  todoId: number
}

export function serializeTodoDragPayload(todoId: number): string {
  const payload: TodoDragPayload = { kind: 'todo', todoId }
  return JSON.stringify(payload)
}

/** Parse either a `DRAG_MIME` JSON payload or a bare `text/plain` number. */
export function parseTodoDragPayload(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed
      && typeof parsed === 'object'
      && (parsed as TodoDragPayload).kind === 'todo'
      && typeof (parsed as TodoDragPayload).todoId === 'number'
    ) {
      return (parsed as TodoDragPayload).todoId
    }
  } catch {
    // fall through to plain-number parse
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** True when a `DataTransfer.types` list carries our todo MIME. */
export function hasTodoDragMime(types: readonly string[]): boolean {
  for (const t of types) if (t === DRAG_MIME) return true
  return false
}
