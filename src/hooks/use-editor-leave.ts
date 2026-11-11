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
 *   Esc is Keep editing); resolves true once saved or discarded. A second
 *   ask while the question is up gets the same answer.
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
  /** Writes the copy and closes. */
  save: () => void
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
      asking.current = null
      if (answer === 'confirm') {
        settled.current = true
        saveRef.current()
        return true
      }
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
    saveRef.current()
  }, [saveRef])
  const discardNow = useCallback(() => {
    settled.current = true
    discardRef.current()
  }, [discardRef])

  return { ask, requestClose, save: saveNow, discard: discardNow }
}
