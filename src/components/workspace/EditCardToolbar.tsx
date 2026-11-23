import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getActiveTab, type LayoutCell } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { mergeChoices, mergeMenuWords, type MergeChoice } from '../../utils/layout-edit-cards'
import type { Side } from '../../utils/workspace-grid'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { ChevronDownIcon, MoreIcon, SplitBelowIcon, SplitRightIcon, TrashIcon } from '../shared/icons'
import { EDIT_CARD_MENU_LABEL } from './cell-menu'
import { focusEditItem } from './edit-focus'
import { mergePreview, showStructurePreview, splitPreview } from './insert-preview'
import { useTabTitles } from './widget-hooks'
import { useLatestRef } from '../../hooks/use-latest-ref'
import styles from './EditCardToolbar.module.css'

/**
 * The selected card's toolbar in the layout edit mode, inside the card at
 * its top-left — under its tab strip when it has one, so the strip stays
 * free to drag: **Split →** and **Split ↓** (each hovered, the table draws
 * the split — `insert-preview.splitPreview`), **Merge ▾** (the neighbours
 * it makes a rectangle with, each drawn while hovered), **Remove** (its
 * active widget; Remove tab on a card of tabs) and **⋯** (the card's menu,
 * which stands in for the card's corner ⋯ meanwhile). Icons only in a card
 * under {@link COMPACT_BELOW_PX} wide — decided while no preview reflows
 * the card, so a button never changes under the pointer. Mounted by the
 * card (`EditCardControls`) while it is selected and nothing is dragged.
 */

/** A card narrower than this (px) shows the toolbar's buttons as icons. */
const COMPACT_BELOW_PX = 330

export function EditCardToolbar({ cell, name, menuOpen, setMoreButton, onMore }: {
  cell: LayoutCell
  /** The card's name (`useCardName`): the toolbar is `<name> card`. */
  name: string
  /** The card's menu is open (its ⋯ pressed). */
  menuOpen: boolean
  setMoreButton: (el: HTMLButtonElement | null) => (() => void) | undefined
  onMore: () => void
}) {
  const layout = useWorkspaceStore((s) => s.working)
  const previewing = useWorkspaceStore((s) => s.structurePreview != null)
  const previewingRef = useLatestRef(previewing)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [compact, setCompact] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const mergeRef = useRef<HTMLButtonElement | null>(null)
  /** What it draws now: a Split or a Merge ▾ entry hovered (the preview goes if the toolbar does). */
  const [drawing, setDrawing] = useState<string | null>(null)
  const drawingRef = useLatestRef(drawing)
  useEffect(() => () => { if (drawingRef.current != null) showStructurePreview(null) }, [drawingRef])

  // Compact or not, by the card's width — not while a preview reflows it.
  useLayoutEffect(() => {
    const card = barRef.current?.closest<HTMLElement>('[data-ws-cell]')
    if (!card) return
    const measure = () => {
      if (!previewingRef.current) setCompact(card.getBoundingClientRect().width < COMPACT_BELOW_PX)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [previewingRef])

  const tabs = useMemo(() => (layout?.cells ?? []).flatMap((c) => c.tabs), [layout])
  const titles = useTabTitles(tabs)
  const cellName = useCallback((c: LayoutCell) => {
    const tab = getActiveTab(c)
    const i = tab ? tabs.indexOf(tab) : -1
    return i >= 0 ? (titles[i] ?? 'A widget') : 'An empty slot'
  }, [tabs, titles])

  if (!layout) return null
  const store = useWorkspaceStore.getState
  const active = getActiveTab(cell)
  const choices = mergeChoices(layout, cell.id)

  /** Starts drawing `key`'s edit (a move onto it, not an enter: the toolbar appearing under a resting pointer draws nothing). */
  const draw = (key: string, make: () => ReturnType<typeof splitPreview>) => {
    if (drawing === key) return
    const next = make()
    setDrawing(next != null ? key : null)
    showStructurePreview(next)
  }
  const undraw = (key: string) => {
    if (drawing !== key) return
    setDrawing(null)
    showStructurePreview(null)
  }
  const split = (side: Side) => {
    setDrawing(null)
    showStructurePreview(null)
    store().splitCell(cell.id, side)
    focusEditItem(cell.id)
  }
  const splitHover = (side: Side) => (e: React.MouseEvent) => {
    if (e.buttons === 0) draw(`split:${side}`, () => splitPreview(layout, cell, side, cellName))
  }
  const merge = (choice: MergeChoice) => {
    setDrawing(null)
    showStructurePreview(null)
    store().mergeCells(cell.id, choice.cell.id)
    store().selectEditCell(cell.id)
    focusEditItem(cell.id)
  }
  const mergeEntries: MenuEntry[] = choices.map((choice) => {
    const key = `merge:${choice.cell.id}`
    return {
      kind: 'item',
      label: mergeMenuWords(choice, cellName(choice.cell)),
      onHover: (on) => (on ? draw(key, () => mergePreview(layout, cell, choice.cell, choice.kind, cellName)) : undraw(key)),
      onSelect: () => merge(choice),
    }
  })
  const removeLabel = cell.tabs.length > 1 ? 'Remove tab' : 'Remove widget'

  return (
    <div
      ref={barRef}
      className={styles.toolbar}
      role="toolbar"
      aria-label={`${name} card`}
      data-edit-toolbar={cell.id}
      data-compact={compact ? '' : undefined}
    >
      <button type="button" className={styles.button} aria-label="Split side by side" data-tooltip="Split side by side" onMouseMove={splitHover('right')} onMouseLeave={() => undraw('split:right')} onClick={() => split('right')}>
        <SplitRightIcon />
        {!compact && <span>Split →</span>}
      </button>
      <button type="button" className={styles.button} aria-label="Split one above the other" data-tooltip="Split one above the other" onMouseMove={splitHover('bottom')} onMouseLeave={() => undraw('split:bottom')} onClick={() => split('bottom')}>
        <SplitBelowIcon />
        {!compact && <span>Split ↓</span>}
      </button>
      <button
        ref={mergeRef}
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={mergeOpen}
        disabled={choices.length === 0}
        data-tooltip={choices.length === 0 ? 'No neighbour makes a rectangle with it' : undefined}
        onClick={() => setMergeOpen((o) => !o)}
      >
        <span>Merge</span>
        <ChevronDownIcon size={12} />
      </button>
      <span className={styles.separator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.button} ${styles.danger}`}
        aria-label={removeLabel}
        data-tooltip={compact ? removeLabel : undefined}
        disabled={!active}
        onClick={() => {
          if (!active) return
          store().removeWidget(active.id)
          focusEditItem(cell.id)
        }}
      >
        <TrashIcon />
        {!compact && <span>Remove</span>}
      </button>
      <button
        ref={setMoreButton}
        type="button"
        className={`${styles.button} ${menuOpen ? styles.pressed : ''}`}
        aria-label={EDIT_CARD_MENU_LABEL}
        data-edit-card-more=""
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-tooltip="Move, swap, insert, stretch…"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onMore()
        }}
      >
        <MoreIcon size={14} />
      </button>
      {mergeOpen && (
        <MenuPopover
          anchorRef={mergeRef}
          placement="bottom-start"
          width={280}
          label="Merge with"
          entries={[{ kind: 'label', text: 'Merge with' }, ...mergeEntries]}
          onClose={() => {
            setMergeOpen(false)
            if (drawing?.startsWith('merge:')) {
              setDrawing(null)
              showStructurePreview(null)
            }
          }}
        />
      )}
    </div>
  )
}
