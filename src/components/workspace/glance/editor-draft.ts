import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useEditorLeave } from '../../../hooks/use-editor-leave'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { configPatch, sameConfigValue } from '../../../utils/config-patch'
import { isInLayerAbove } from '../../../utils/dom-layers'
import { useExpressionReports } from '../../shared/filters/expression-report'

/** Why Save is held back while an expression field's text doesn't read. */
export const SAVE_UNREADABLE_TITLE = 'A filter expression doesn’t read — fix it or put it back (Esc) to save'

export interface EditorDraft<C extends object> {
  /** The config as edited (the stored one until a control changes it). */
  draft: C
  /** Edits the draft: nothing is written until Save. */
  patch: (p: Partial<C>) => void
  /** The draft differs from the config as the editor opened, or a field holds typed text. */
  changed: boolean
  /** Save is offered: changed, and no field holds text that doesn't read. */
  canSave: boolean
  /** Writes the changed keys as one config update and closes. */
  save: () => void
  /** Closes without writing. */
  discard: () => void
  /**
   * Esc, × or a press elsewhere: closes at once while unchanged; changed,
   * asks Save / Discard / Keep editing. Returns whether it held the close
   * (asked, or a question is already up).
   */
  requestClose: () => boolean
  /** The expression fields' reporter, for `ExpressionReportProvider`. */
  reportExpression: ReturnType<typeof useExpressionReports>['report']
}

/**
 * A widget editor's Save / Discard (the Number's, a chart's, Project
 * pulse's), Edit list's pattern: the editor edits a copy of the widget's
 * config, which the widget draws live (`widget-preview-store`, as a list
 * shows its draft), and nothing is written until Save — then, for good and
 * as one undo step, only the keys that changed (`configPatch`), so a write
 * made meanwhile elsewhere (a ⋯ menu's Tags) stays; Discard drops the copy and the widget is as stored
 * again. Nothing is kept across a reload.
 * Closing with changes asks first, as Settings' lens editor does (the
 * shared confirm prompt: Save / Discard / Keep editing; its Esc is Keep
 * editing).
 */
export function useEditorDraft<C extends object>({ tabId, stored, write, onClose, promptTitle, droppedNotice = 'The editor closed: its changes weren’t saved.' }: {
  /** The widget's tab (its live preview). */
  tabId: string
  /** The widget's config as stored (read once, as the editor opens). */
  stored: C
  /** Writes a patch of the config (layout config). */
  write: (patch: Partial<C>) => void
  onClose: () => void
  /** The close question's title. */
  promptTitle: string
  /** The notice when it is closed with changes from outside (its widget gone). */
  droppedNotice?: string
}): EditorDraft<C> {
  const [base] = useState(stored)
  const [draft, setDraft] = useState(stored)
  // The draft as of the last edit, for a Save in the same event as a field's write (a blur).
  const draftRef = useRef(draft)
  const expressions = useExpressionReports()
  const draftChanged = !sameConfigValue(base, draft)
  const changed = draftChanged || expressions.pending
  const canSave = changed && !expressions.unreadable

  // The widget draws the copy while it differs; as stored again once the editor goes.
  useEffect(() => {
    const previews = useWidgetPreviewStore.getState()
    if (draftChanged) previews.setPreview(tabId, draft)
    else previews.clearPreview(tabId)
  }, [tabId, draft, draftChanged])
  useEffect(() => () => useWidgetPreviewStore.getState().clearPreview(tabId), [tabId])

  const patch = useCallback((p: Partial<C>) => {
    // A key patched to `undefined` goes, as `patchTabConfig` drops it.
    const next = Object.fromEntries(Object.entries({ ...draftRef.current, ...p }).filter(([, v]) => v !== undefined)) as C
    draftRef.current = next
    setDraft(next)
  }, [])

  const writeRef = useLatestRef(write)
  const onCloseRef = useLatestRef(onClose)
  const saveNow = useCallback(() => {
    const p = configPatch(base, draftRef.current)
    if (Object.keys(p).length > 0) writeRef.current(p)
    onCloseRef.current()
  }, [base, writeRef, onCloseRef])
  const close = useCallback(() => onCloseRef.current(), [onCloseRef])

  // The question, and the app's one rule for leaving an editor with changes (`stores/editor-leave`).
  const changedRef = useLatestRef(changed)
  const leave = useEditorLeave({
    changedRef,
    title: promptTitle,
    save: saveNow,
    discard: close,
    dropped: droppedNotice,
  })

  const canSaveRef = useLatestRef(canSave)
  const leaveSave = leave.save
  const save = useCallback(() => {
    if (canSaveRef.current) leaveSave()
  }, [canSaveRef, leaveSave])

  return {
    draft,
    patch,
    changed,
    canSave,
    save,
    discard: leave.discard,
    requestClose: leave.requestClose,
    reportExpression: expressions.report,
  }
}

/**
 * What a press elsewhere is for a widget editor (`usePressElsewhereCloses`):
 * not inside it, not on its anchor (the widget it edits), and not in a layer
 * stacked above it (a picker, a menu, the close question).
 */
export function widgetEditorElsewhere(t: EventTarget | null, panel: HTMLElement | null, anchor: HTMLElement | null): boolean {
  if (!(t instanceof Node) || !t.isConnected) return false
  if (!panel || panel.contains(t) || isInLayerAbove(panel, t)) return false
  return !anchor?.contains(t)
}
