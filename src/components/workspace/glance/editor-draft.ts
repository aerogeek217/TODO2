import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useUIStore } from '../../../stores/ui-store'
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
 * shows its draft), and nothing is written until Save — then only the keys
 * that changed (`configPatch`), so a write made meanwhile elsewhere (a ⋯
 * menu's Tags) stays; Discard drops the copy and the widget is as stored
 * again. Nothing is kept across a reload.
 * Closing with changes asks first, as Settings' lens editor does (the
 * shared confirm prompt: Save / Discard / Keep editing; its Esc is Keep
 * editing).
 */
export function useEditorDraft<C extends object>({ tabId, stored, write, onClose, promptTitle }: {
  /** The widget's tab (its live preview). */
  tabId: string
  /** The widget's config as stored (read once, as the editor opens). */
  stored: C
  /** Writes a patch of the config (layout config). */
  write: (patch: Partial<C>) => void
  onClose: () => void
  /** The close question's title. */
  promptTitle: string
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

  const canSaveRef = useLatestRef(canSave)
  const save = useCallback(() => {
    if (canSaveRef.current) saveNow()
  }, [canSaveRef, saveNow])

  const changedRef = useLatestRef(changed)
  const titleRef = useLatestRef(promptTitle)
  const asking = useRef(false)
  const requestClose = useCallback((): boolean => {
    if (asking.current) return true
    if (!changedRef.current) {
      onCloseRef.current()
      return false
    }
    asking.current = true
    void useUIStore.getState().askChoice({
      title: titleRef.current,
      message: 'Your changes will be lost if you don’t save.',
      confirmLabel: 'Save',
      discardLabel: 'Discard',
      cancelLabel: 'Keep editing',
    }).then((answer) => {
      asking.current = false
      if (answer === 'confirm') saveNow()
      else if (answer === 'discard') onCloseRef.current()
    })
    return true
  }, [changedRef, onCloseRef, titleRef, saveNow])

  return {
    draft,
    patch,
    changed,
    canSave,
    save,
    discard: onClose,
    requestClose,
    reportExpression: expressions.report,
  }
}

/**
 * A press elsewhere asks the editor to close (`requestClose`). Not
 * elsewhere: inside it, on its anchor (the widget it edits), or in a layer
 * stacked above it (a picker, a menu, the close question). A press the
 * editor holds (it asked) is swallowed — its click too — so it doesn't go
 * on to what it pressed; one it lets close goes on. Capture phase on the
 * document, after an expression field's own hold (on the window), which
 * stops the press first.
 */
export function usePressElsewhereCloses(
  panel: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  requestClose: () => boolean,
): void {
  const requestRef = useLatestRef(requestClose)
  useEffect(() => {
    const elsewhere = (t: EventTarget | null): boolean => {
      if (!(t instanceof Node) || !t.isConnected) return false
      const el = panel.current
      if (!el || el.contains(t) || isInLayerAbove(el, t)) return false
      return !anchorRef.current?.contains(t)
    }
    // A real press starts with pointerdown (decided there); its mousedown follows.
    let pointerDecided = false
    let held = false
    const onPress = (e: Event) => {
      if (e.type === 'mousedown' && pointerDecided) {
        pointerDecided = false
        if (held) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      pointerDecided = e.type === 'pointerdown'
      held = elsewhere(e.target) && requestRef.current()
      if (!held) return
      if (e.type === 'mousedown') e.preventDefault()
      e.stopPropagation()
    }
    const onClick = (e: MouseEvent) => {
      if (!held) return
      held = false
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('mousedown', onPress, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('mousedown', onPress, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [panel, anchorRef, requestRef])
}
