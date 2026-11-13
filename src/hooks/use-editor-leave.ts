import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { registerOpenEditor } from '../stores/editor-leave'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'
import { useLatestRef } from './use-latest-ref'

/**
 * The leave question of an editor dialog that holds a copy until its Save
 * (Edit list, the widget editors), and its place in the app's one rule
 * (`stores/editor-leave`):
 * - `ask()` — Save / Discard / Keep editing (the shared confirm prompt; its
 *   Esc is Keep editing); resolves true once saved or discarded — for a
 *   `save` that returns a promise, once that write landed (false when it
 *   didn't: the editor is still open). A second ask while the question is
 *   up, or the save in flight, gets the same answer.
 * - `requestClose()` — the dialog's own Esc, ×, a press elsewhere: closes at
 *   once while unchanged (`discard`), else asks; returns whether it held the
 *   close (asked).
 * - While mounted it is registered, so whatever would leave it from outside
 *   (Settings, another editor, a layout switch, a route change) asks first
 *   (`afterLeavingEditors`).
 * - Closed anyway with changes, not through Save or Discard (its subject
 *   gone — a data replace, an undo, another tab), it says so (`dropped`).
 * - `save` / `discard` — its footer's buttons: they close it for good, so
 *   closing drops nothing.
 */
export function useEditorLeave({ changedRef, title, save, discard, dropped }: {
  /** Whether it holds changes, now. */
  changedRef: RefObject<boolean>
  /** The question's title (`Save changes to list “X”?`). */
  title: string
  /**
   * Writes the copy and closes. It may say how the write went: a promise of
   * `false` (or a rejection) means nothing was saved and the editor stays
   * open — the leave question then resolves false, and a later close still
   * counts its changes as unsaved.
   */
  save: () => void | Promise<boolean>
  /** Drops the copy and closes. */
  discard: () => void
  /** The notice when it is closed with changes from outside (`Edit list closed: …`). */
  dropped: string
}): { ask: () => Promise<boolean>; requestClose: () => boolean; save: () => void; discard: () => void } {
  const titleRef = useLatestRef(title)
  const saveRef = useLatestRef(save)
  const discardRef = useLatestRef(discard)
  const droppedRef = useLatestRef(dropped)
  // Saved or discarded: closing then drops nothing.
  const settled = useRef(false)
  const asking = useRef<Promise<boolean> | null>(null)

  const ask = useCallback((): Promise<boolean> => {
    asking.current ??= useUIStore.getState().askChoice({
      title: titleRef.current,
      message: 'Your changes will be lost if you don’t save.',
      confirmLabel: 'Save',
      discardLabel: 'Discard',
      cancelLabel: 'Keep editing',
    }).then((answer) => {
      if (answer === 'confirm') {
        settled.current = true
        const saved = saveRef.current()
        if (!(saved instanceof Promise)) {
          asking.current = null
          return true
        }
        // A save that says how it went: one that didn't land (a failed write) leaves the editor open with its
        // changes, so whatever asked doesn't carry on — the same as Keep editing.
        return saved.catch(() => false).then((ok) => {
          asking.current = null
          if (ok === false) settled.current = false
          return ok !== false
        })
      }
      asking.current = null
      if (answer === 'discard') {
        settled.current = true
        discardRef.current()
        return true
      }
      return false
    })
    return asking.current
  }, [titleRef, saveRef, discardRef])

  const requestClose = useCallback((): boolean => {
    if (asking.current) return true
    if (!changedRef.current) {
      settled.current = true
      discardRef.current()
      return false
    }
    void ask()
    return true
  }, [changedRef, discardRef, ask])

  useEffect(() => registerOpenEditor({ changed: () => changedRef.current, ask }), [changedRef, ask])

  // Closed with changes from outside: say so (a StrictMode re-mount has no changes yet).
  useEffect(() => () => {
    if (changedRef.current && !settled.current) useUndoStore.getState().notify(droppedRef.current)
  }, [changedRef, droppedRef])

  const saveNow = useCallback(() => {
    settled.current = true
    const saved = saveRef.current()
    // A save that didn't land: its changes are unsaved again.
    if (saved instanceof Promise) void saved.catch(() => false).then((ok) => { if (ok === false) settled.current = false })
  }, [saveRef])
  const discardNow = useCallback(() => {
    settled.current = true
    discardRef.current()
  }, [discardRef])

  return { ask, requestClose, save: saveNow, discard: discardNow }
}
