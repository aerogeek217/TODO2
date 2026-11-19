import { useEffect, useLayoutEffect, useRef } from 'react'
import { layoutEditChanged, useWorkspaceStore } from '../../stores/workspace-store'
import { useShortcutLabel } from '../../hooks/use-shortcut-label'
import { useUIStore } from '../../stores/ui-store'
import { leaveLayout } from '../../stores/editor-leave'
import { DisabledLayoutTabs } from '../workspace/LayoutTabs'
import { LayoutEditTray } from '../workspace/LayoutEditTray'
import { EyeIcon, RedoIcon, UndoIcon } from '../shared/icons'
import { incomingPlaced } from '../../utils/layout-transfer'
import topBarStyles from './TopBar.module.css'
import { LAYOUT_EDIT_TRAY_ATTR } from '../../utils/dom-contract'
import styles from './LayoutEditBar.module.css'

/** Where a press or a key may sit without the mode's Esc being its: a popover, a menu, a dialog. */
const LAYER_SELECTOR = '[data-popover-level], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'

/** A workspace drag in progress (the page marks itself while a card, tab or tray chip is dragged). */
const DRAGGING_SELECTOR = '[data-dragging-tab="true"]'

/**
 * Esc in the layout edit mode: a tap's pending move cancelled (E3); else,
 * with changes, Save / Discard / Keep editing (`askLeaveEdit`); with none,
 * the mode closes. Not an Esc a layer took — a
 * menu (it stops it), a popover or a dialog (one open when the key went
 * down: its own Esc closes it) — nor one a control already handled.
 */
function useModeEscape(): void {
  useEffect(() => {
    let layered = false
    const capture = (e: KeyboardEvent) => {
      // A drag's Esc (a card, a tab, a tray chip, a corner) cancels the drag, not the mode.
      if (e.key === 'Escape') layered = document.querySelector(LAYER_SELECTOR) != null || document.querySelector(DRAGGING_SELECTOR) != null
    }
    const bubble = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || layered) return
      e.preventDefault()
      const ws = useWorkspaceStore.getState()
      // Widgets in hand (Move / Copy to layout), not placed yet: Esc goes back to their layout.
      if (ws.editing?.incoming && !incomingPlaced(ws.working, ws.editing.incoming)) {
        ws.cancelEdit()
        return
      }
      // A tap's pending move (E3): Esc cancels it, the mode stays.
      if (ws.editing?.moveArmed) {
        ws.disarmEditMove()
        return
      }
      if (layoutEditChanged(ws)) void ws.askLeaveEdit()
      else ws.leaveEdit()
    }
    window.addEventListener('keydown', capture, true)
    window.addEventListener('keydown', bubble)
    return () => {
      window.removeEventListener('keydown', capture, true)
      window.removeEventListener('keydown', bubble)
    }
  }, [])
}

/**
 * The focus in the layout edit mode: on Done as it opens; back where it was
 * when the mode closes (the cell's ⋯ it opened from), else on the open
 * layout's tab (or the picker) — unless something else has taken it by then (Settings,
 * a dialog).
 */
function useModeFocus(done: React.RefObject<HTMLButtonElement | null>, first: React.RefObject<HTMLButtonElement | null>): void {
  useLayoutEffect(() => {
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    // With widgets in hand Done is off until they are placed: At the bottom takes the focus.
    ;(first.current ?? done.current)?.focus()
    return () => {
      setTimeout(() => {
        const now = document.activeElement
        if (now && now !== document.body && now.isConnected) return
        if (opener?.isConnected) opener.focus()
        else document.querySelector<HTMLElement>('[data-layout-controls] [role="tab"][aria-selected="true"], [data-testid="layout-picker"]')?.focus()
      }, 0)
    }
  }, [done, first])
}

/**
 * A layout action asked for while the mode is on (the palette's Go to
 * Layout ›, New / Duplicate Layout… — `ui-store.requestLayout`, which the
 * layout tabs run and which aren't mounted now): it leaves the layout, so
 * the mode asks first (`leaveLayout`) and closes; then the request is made
 * again for the layout tabs, back in the bar.
 */
function useLayoutRequestsInMode(): void {
  useEffect(() => useUIStore.subscribe((s) => {
    const request = s.layoutRequest
    if (!request) return
    useUIStore.getState().clearLayoutRequest()
    void leaveLayout().then((left) => {
      if (left) setTimeout(() => useUIStore.getState().requestLayout(request), 0)
    })
  }), [])
}

/**
 * The top bar while the layout edit mode is on (layout edit mode E1): in
 * place of the bar's contents, `Editing “Default”`, the layouts as tabs
 * (shown, disabled: leaving the layout goes through Done or Cancel), the
 * widget tray (`LAYOUT_EDIT_TRAY_ATTR`, `LayoutEditTray`: the kinds as chips
 * to drag in or click; a tap's pending move's hint in their place),
 * then the mode's Undo and Redo (its own steps, as Ctrl+Z / Ctrl+Y are
 * while it is on), Cancel and Done. Esc leaves (asking with changes).
 */
export function LayoutEditBar() {
  const name = useWorkspaceStore((s) => s.saved?.name ?? '')
  const layouts = useWorkspaceStore((s) => s.layouts)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const canUndo = useWorkspaceStore((s) => (s.editing?.undo.length ?? 0) > 0)
  const canRedo = useWorkspaceStore((s) => (s.editing?.redo.length ?? 0) > 0)
  const undoKeys = useShortcutLabel('undo')
  const redoKeys = useShortcutLabel('redo')
  const incoming = useWorkspaceStore((s) => s.editing?.incoming ?? null)
  const placed = useWorkspaceStore((s) => incomingPlaced(s.working, s.editing?.incoming))
  const showContent = useWorkspaceStore((s) => s.editing?.showContent ?? false)
  const doneRef = useRef<HTMLButtonElement | null>(null)
  const bottomRef = useRef<HTMLButtonElement | null>(null)
  useModeFocus(doneRef, bottomRef)
  useModeEscape()
  useLayoutRequestsInMode()
  const store = useWorkspaceStore.getState

  return (
    <header className={`${topBarStyles.topBar} ${styles.bar}`} data-layout-edit-bar="" aria-label="Edit layout">
      <span className={styles.label} data-testid="layout-edit-label">
        <span className={styles.dot} aria-hidden="true" />
        Editing “{name}”
      </span>
      <div className={styles.tabs}>
        <DisabledLayoutTabs layouts={layouts} activeLayoutId={activeLayoutId} />
      </div>
      <div className={styles.tray} {...{ [LAYOUT_EDIT_TRAY_ATTR]: '' }}>
        <LayoutEditTray />
      </div>
      <div className={styles.actions}>
        {/* Round two (concept A): the cards are blueprints; this shows their widgets, dimmed. */}
        <button
          type="button"
          className={`${styles.ghost} ${showContent ? styles.ghostOn : ''}`}
          aria-pressed={showContent}
          data-tooltip={showContent ? 'Show the cards as blueprints' : 'Show the widgets’ content'}
          aria-label="Content"
          data-testid="layout-edit-content"
          onClick={() => store().setEditContent(!showContent)}
        >
          <EyeIcon />
          <span className={styles.contentLabel}>Content</span>
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={!canUndo}
          data-tooltip="Undo"
          data-tooltip-shortcut={undoKeys || undefined}
          onClick={() => store().undoEdit()}
        >
          <UndoIcon />
          <span>Undo</span>
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={!canRedo}
          data-tooltip="Redo"
          data-tooltip-shortcut={redoKeys || undefined}
          onClick={() => store().redoEdit()}
        >
          <RedoIcon />
          <span>Redo</span>
        </button>
        {incoming && !placed && (
          <button
            ref={bottomRef}
            type="button"
            className={styles.ghost}
            data-testid="layout-edit-place-bottom"
            data-tooltip={`Put “${incoming.name}” in a new row at the bottom`}
            onClick={() => { store().placeIncoming({ kind: 'bottom' }) }}
          >
            At the bottom
          </button>
        )}
        <button
          type="button"
          className={styles.cancel}
          data-tooltip={incoming ? `Back to “${incoming.sourceName}”, nothing changed` : undefined}
          onClick={() => store().cancelEdit()}
        >
          Cancel
        </button>
        <button
          ref={doneRef}
          type="button"
          className={styles.done}
          disabled={incoming != null && !placed}
          data-tooltip={incoming && !placed ? `Place “${incoming.name}” first` : undefined}
          onClick={() => { void store().finishEdit() }}
        >
          Done
        </button>
      </div>
    </header>
  )
}
