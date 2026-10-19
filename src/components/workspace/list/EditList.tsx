import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { usePopoverAnchor, type PopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useListWidgetCount } from '../../../hooks/use-list-widget-count'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { findTab } from '../../../utils/workspace-layout-ops'
import { ListEditorBody } from '../../shared/ListEditorBody'
import { CloseIcon, LinkIcon } from '../../shared/icons'
import styles from './EditList.module.css'

/** The side popover's width (px) and its gap to the panel. */
const POPOVER_WIDTH_PX = 340
const POPOVER_GAP_PX = 8
const VIEWPORT_MARGIN_PX = 8
/** The popover's top sits this far below the panel's top (its arrow then points at the tab strip). */
const TOP_INSET_PX = 6

/** The list as edited (its shared draft, else the saved list), the saved list, and the draft actions. */
function useEditListModel(listDefinitionId: number) {
  const saved = useListDefinitionStore((s) => s.listDefinitions.find((d) => d.id === listDefinitionId))
  const draft = useListDraftStore((s) => s.drafts[listDefinitionId])
  const widgets = useListWidgetCount(listDefinitionId)
  const def = saved ? (draft ?? saved) : undefined
  return {
    def,
    saved,
    dirty: saved != null && draft != null,
    canSave: saved != null && draft != null && draft.name.trim() !== '',
    widgets,
    onChange: (next: PersistedListDefinition) => useListDraftStore.getState().edit(listDefinitionId, () => next),
    save: () => { void useListDraftStore.getState().save(listDefinitionId) },
    revert: () => useListDraftStore.getState().revert(listDefinitionId),
  }
}

/** `Shared · N widgets` / `In 1 widget`. */
function sharedText(widgets: number): string {
  return widgets === 1 ? 'In 1 widget' : `Shared · ${widgets} widgets`
}

/** A key that landed on the page itself: nothing is focused. */
function isPageTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target === document.body || target === document.documentElement
}

/**
 * Esc closes the surface when the key comes from inside it (or with nothing
 * focused) and no layer inside handled it first — a menu or a filter picker
 * opened from it takes its own Esc. Bubble phase, after those layers.
 */
function useEscapeCloses(panelRef: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useLatestRef(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const panel = panelRef.current
      const inside = panel != null && e.target instanceof Node && panel.contains(e.target)
      if (!inside && !isPageTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelRef, onCloseRef])
}

/**
 * Focus goes back where it was when the surface opened — or, when that is
 * gone (the tab menu item it was opened from), to the list's tab — unless
 * something else took it.
 */
function useFocusReturn(panelRef: React.RefObject<HTMLElement | null>, tabId: string): void {
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    const panel = panelRef.current
    return () => {
      const active = document.activeElement
      const focusLeft = !active || active === document.body || !active.isConnected || (panel?.contains(active) ?? false)
      if (!focusLeft) return
      const tab = document.querySelector<HTMLElement>(`[data-ws-tab="${tabId}"]`)
      const target = opener && opener !== document.body && opener.isConnected ? opener : tab
      target?.focus({ preventScroll: true })
    }
  }, [panelRef, opener, tabId])
}

/**
 * Edit list: the one surface for a list's name, filters, group, sort,
 * prompt and Show completed. Every control edits the list's shared draft at
 * once (`list-draft-store`), so every widget showing the list updates live
 * and shows it unsaved; Save list / Revert act on that draft. Desktop: a
 * non-modal popover beside the list's panel; phone: a half sheet with the
 * list live above it. Opened through `ui-store.openListEditor` (one at a
 * time); closing keeps the draft.
 */
export function EditListHost() {
  const target = useUIStore((s) => s.listEditor)
  const isMobile = useIsMobile()
  const listMissing = useListDefinitionStore((s) => target != null && !s.listDefinitions.some((d) => d.id === target.listDefinitionId))
  const close = useUIStore((s) => s.closeListEditor)
  useEffect(() => {
    if (listMissing) close()
  }, [listMissing, close])
  if (!target || listMissing) return null
  const key = `${target.listDefinitionId}-${target.tabId}`
  return isMobile
    ? <EditListSheet key={key} listDefinitionId={target.listDefinitionId} tabId={target.tabId} onClose={close} />
    : <EditListPopover key={key} listDefinitionId={target.listDefinitionId} tabId={target.tabId} onClose={close} />
}

interface SurfaceProps {
  listDefinitionId: number
  tabId: string
  onClose: () => void
}

/** Where the popover goes: beside the panel (the hook picks the side), or below its filter line when neither side fits. */
type Placement =
  | { mode: 'beside'; rect: { left: number; top: number; right: number; bottom: number } }
  | { mode: 'below'; rect: { left: number; top: number; right: number; bottom: number } }

function cellOf(tabId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-ws-tab="${tabId}"]`)?.closest<HTMLElement>('[data-ws-cell]') ?? null
}

function measurePlacement(cell: HTMLElement, tabId: string): Placement {
  const r = cell.getBoundingClientRect()
  const vw = window.innerWidth
  const fitsRight = r.right + POPOVER_GAP_PX + POPOVER_WIDTH_PX <= vw - VIEWPORT_MARGIN_PX
  const fitsLeft = r.left - POPOVER_GAP_PX - POPOVER_WIDTH_PX >= VIEWPORT_MARGIN_PX
  if (fitsRight || fitsLeft) {
    return { mode: 'beside', rect: { left: r.left, right: r.right, top: r.top + TOP_INSET_PX, bottom: r.bottom } }
  }
  // Last resort: over the lower rows, under the filter line (else the header), right-aligned to the panel.
  const widget = cell.querySelector(`[data-list-host="${tabId}"]`)
  const line = widget?.querySelector('[data-testid="list-filter-row"]') ?? cell.querySelector('[data-ws-cell-header]')
  const b = (line ?? cell).getBoundingClientRect()
  return { mode: 'below', rect: { left: r.left, right: r.right - TOP_INSET_PX, top: b.top, bottom: b.bottom } }
}

/** `readPlacement` when the list isn't on screen. */
const MISSING = 'missing'

/**
 * Where the popover goes now, as a string (so an unchanged placement reads
 * equal): `MISSING` when the list's tab or widget isn't on screen.
 */
function readPlacement(tabId: string): string {
  const cell = cellOf(tabId)
  if (!cell?.querySelector(`[data-list-host="${tabId}"]`)) return MISSING
  return JSON.stringify(measurePlacement(cell, tabId))
}

/**
 * The desktop popover: 340 wide beside the list's panel (right, else left,
 * else below its filter line), its arrow at the panel's tab strip. Not
 * modal — the list stays usable; a click elsewhere in the app, Esc or ×
 * closes it, and so does the list leaving the screen.
 */
function EditListPopover({ listDefinitionId, tabId, onClose }: SurfaceProps) {
  const model = useEditListModel(listDefinitionId)
  const panelElRef = useRef<HTMLDivElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const cellRef = useRef<HTMLElement | null>(null)
  // Re-read whenever the layout changes (the list's tab may have moved, closed or switched).
  const working = useWorkspaceStore((s) => s.working)
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener('resize', notify)
    window.addEventListener('scroll', notify, true)
    // The cell holding the tab in the layout as it is now (a layout change
    // re-subscribes, so the observer follows the tab to another cell).
    const cellId = working ? findTab(working, tabId)?.panelId : undefined
    const cell = cellId != null ? document.querySelector(`[data-ws-cell="${cellId}"]`) : null
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(notify) : null
    if (ro && cell) ro.observe(cell)
    return () => {
      window.removeEventListener('resize', notify)
      window.removeEventListener('scroll', notify, true)
      ro?.disconnect()
    }
  }, [tabId, working])
  const snapshot = useSyncExternalStore(subscribe, () => readPlacement(tabId))
  const placement = useMemo<Placement | null>(() => (snapshot === MISSING ? null : JSON.parse(snapshot) as Placement), [snapshot])

  // The list left the screen (tab closed, switched, collapsed): nothing to preview.
  const seen = useRef(false)
  useEffect(() => {
    if (placement) {
      seen.current = true
      cellRef.current = cellOf(tabId)
    } else if (seen.current) onClose()
  }, [placement, tabId, onClose])

  const anchor: PopoverAnchor = placement ? { kind: 'rect', ...placement.rect } : { kind: 'point', x: -9999, y: -9999 }
  const { panelRef, style, placementUsed, placed } = usePopoverAnchor({
    anchor,
    open: placement != null,
    placement: placement?.mode === 'below' ? 'bottom-end' : 'right-start',
    offset: POPOVER_GAP_PX,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    observeSize: true,
    onClose,
  })
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    panelElRef.current = el
    panelRef(el)
  }, [panelRef])

  // A press elsewhere in the app closes it. Not: inside it, in its own
  // panel (the previewed list stays usable), or in a layer portaled out of
  // the app — the menus, pickers and dialogs opened from it.
  const onCloseRef = useLatestRef(onClose)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Element) || !t.isConnected) return
      if (panelElRef.current?.contains(t) || cellRef.current?.contains(t)) return
      const root = document.getElementById('root')
      if (root && !root.contains(t)) return
      if (t.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="tooltip"]')) return
      onCloseRef.current()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onCloseRef])

  useEscapeCloses(panelElRef, onClose)
  useFocusReturn(panelElRef, tabId)

  // Focus starts in Name once the popover is placed.
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (!placed || focused.current) return
    focused.current = true
    nameRef.current?.focus({ preventScroll: true })
  }, [placed])

  if (!model.def || !model.saved) return null
  const arrow = placement?.mode === 'below' ? null : placementUsed === 'left-start' ? 'right' : 'left'

  return createPortal(
    <div
      ref={setPanel}
      className={styles.popover}
      style={{ left: style.left, top: style.top, visibility: placed ? undefined : 'hidden' }}
      role="dialog"
      aria-label={`Edit list ${model.def.name.trim() || model.saved.name}`}
      data-testid="edit-list"
      data-placement={placement?.mode === 'below' ? 'below' : placementUsed}
      // Keys inside are the form's, not the app's shortcuts.
      data-shortcut-scope="none"
    >
      {arrow && <span className={`${styles.arrow} ${arrow === 'right' ? styles.arrowRight : ''}`} aria-hidden="true" />}
      <header className={styles.header}>
        <span className={styles.eyebrow}>Edit list</span>
        <button type="button" className={styles.close} aria-label="Close (changes stay unsaved)" title="Close (changes stay unsaved)" onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </header>
      <div className={styles.body}>
        <ListEditorBody draft={model.def} saved={model.saved} onChange={model.onChange} variant="popover" nameRef={nameRef} />
        <p className={styles.hint}>Changes show in the list right away and stay unsaved until you save.</p>
      </div>
      <Footer model={model} className={styles.footer} buttonClass={styles.footerButton} saveClass={styles.footerSave}>
        <span className={styles.shared}><LinkIcon /> {sharedText(model.widgets)}</span>
      </Footer>
    </div>,
    document.body,
  )
}

/** Revert · Save list: both disabled while the draft equals the saved list. */
function Footer({ model, className, buttonClass, saveClass, children }: {
  model: ReturnType<typeof useEditListModel>
  className: string | undefined
  buttonClass: string | undefined
  saveClass: string | undefined
  children?: ReactNode
}) {
  return (
    <footer className={className}>
      {children}
      <button type="button" className={buttonClass} disabled={!model.dirty} onClick={model.revert}>
        Revert
      </button>
      <button
        type="button"
        className={`${buttonClass} ${saveClass}`}
        disabled={!model.canSave}
        title={model.dirty && !model.canSave ? 'Name the list to save it' : undefined}
        onClick={model.save}
      >
        Save list
      </button>
    </footer>
  )
}

/** The handle's drag: up past this opens the sheet full height, down past it closes it. */
const SHEET_DRAG_PX = 40

/**
 * The phone's half sheet: the same form at touch sizes, 55% of the screen
 * high with the list live above it (a light scrim; a tap on it closes the
 * sheet). The handle drags it up to full height, or down to close.
 */
function EditListSheet({ listDefinitionId, tabId, onClose }: SurfaceProps) {
  const model = useEditListModel(listDefinitionId)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [full, setFull] = useState(false)
  const dragFrom = useRef<number | null>(null)
  useEscapeCloses(sheetRef, onClose)
  useFocusReturn(sheetRef, tabId)
  // Focus the sheet itself, not Name: no keyboard popping up on open.
  useLayoutEffect(() => { sheetRef.current?.focus({ preventScroll: true }) }, [])

  if (!model.def || !model.saved) return null
  return createPortal(
    <>
      <div className={`${styles.scrim} ${full ? styles.scrimFull : ''}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={`${styles.sheet} ${full ? styles.sheetFull : ''}`}
        role="dialog"
        aria-label={`Edit list ${model.def.name.trim() || model.saved.name}`}
        data-testid="edit-list"
        data-shortcut-scope="none"
        data-touch-chips=""
        tabIndex={-1}
      >
        <span
          className={styles.handle}
          aria-hidden="true"
          onPointerDown={(e) => {
            dragFrom.current = e.clientY
            e.currentTarget.setPointerCapture?.(e.pointerId)
          }}
          onPointerUp={(e) => {
            const from = dragFrom.current
            dragFrom.current = null
            if (from == null) return
            const dy = e.clientY - from
            if (dy < -SHEET_DRAG_PX) setFull(true)
            else if (dy > SHEET_DRAG_PX) {
              if (full) setFull(false)
              else onClose()
            }
          }}
          onPointerCancel={() => { dragFrom.current = null }}
        />
        <header className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>Edit list</span>
          <button type="button" className={styles.sheetClose} aria-label="Close (changes stay unsaved)" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </header>
        <div className={styles.sheetBody}>
          <ListEditorBody draft={model.def} saved={model.saved} onChange={model.onChange} variant="sheet" />
        </div>
        <Footer model={model} className={styles.sheetFooter} buttonClass={styles.sheetButton} saveClass={styles.sheetSave} />
      </div>
    </>,
    document.body,
  )
}
