import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { getActiveTab, type LayoutCell, type WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { otherCards } from '../../utils/layout-edit-cards'
import { mergeNeighbour, type Side } from '../../utils/workspace-grid'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { ChevronDownIcon, SplitBelowIcon, SplitRightIcon, TrashIcon } from '../shared/icons'
import { focusEditItem } from './edit-focus'
import { showStructurePreview, splitPreview } from './insert-preview'
import { useTabTitles } from './widget-hooks'
import { useWorkspaceDrag } from './workspace-drag'
import styles from './EditCardToolbar.module.css'

/**
 * The selected card's toolbar in the layout edit mode (layout editor round
 * two, concept A): Split → and Split ↓ (each hovered, the table draws the
 * split — `insert-preview.splitPreview`), Swap ▾ (every other card), Merge
 * ▾ (the neighbours it makes a rectangle with) and Remove (its active
 * widget; Remove tab on a card of tabs). Fixed over the table, above the
 * card — inside it under its header when there is no room above (the top
 * row), so its tab strip stays free to drag —, it
 * stays where it is while a preview reflows the table under it. Not while
 * something is dragged. The card's menu (⋯) keeps every action.
 */

/** The toolbar's height and its gap above the card, px. */
const BAR_PX = 32
const GAP_PX = 6
/** With no room above (the top row): under the card's header (its tab strip, which drags), px from its top. */
const BELOW_HEADER_PX = 32 + GAP_PX

const SIDE_WORDS: Record<Side, string> = { left: 'on the left', top: 'above', right: 'on the right', bottom: 'below' }

export function EditCardToolbar({ layout, tableRef }: { layout: WorkspaceLayout; tableRef: RefObject<HTMLDivElement | null> }) {
  const selectedId = useWorkspaceStore((s) => s.editing?.selectedCellId ?? null)
  const previewing = useWorkspaceStore((s) => s.structurePreview != null)
  const drag = useWorkspaceDrag()
  const cell = layout.cells.find((c) => c.id === selectedId && c.tabs.length > 0)
  if (!cell || drag) return null
  return <Toolbar key={cell.id} cell={cell} layout={layout} tableRef={tableRef} frozen={previewing} />
}

function Toolbar({ cell, layout, tableRef, frozen }: { cell: LayoutCell; layout: WorkspaceLayout; tableRef: RefObject<HTMLDivElement | null>; frozen: boolean }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const [menu, setMenu] = useState<'swap' | 'merge' | null>(null)
  /** A Split hovered: its preview shows (and goes if the toolbar does). */
  const [splitting, setSplitting] = useState(false)
  useEffect(() => (splitting ? () => showStructurePreview(null) : undefined), [splitting])
  const swapRef = useRef<HTMLButtonElement | null>(null)
  const mergeRef = useRef<HTMLButtonElement | null>(null)
  const tabs = useMemo(() => layout.cells.flatMap((c) => c.tabs), [layout.cells])
  const titles = useTabTitles(tabs)
  const cellName = useCallback((c: LayoutCell) => {
    const tab = getActiveTab(c)
    const i = tab ? tabs.indexOf(tab) : -1
    return i >= 0 ? (titles[i] ?? 'A widget') : 'An empty slot'
  }, [tabs, titles])

  // Its place, from the card as drawn — not while a preview reflows the table under it.
  useLayoutEffect(() => {
    if (frozen) return
    const table = tableRef.current
    const place = () => {
      const el = table?.querySelector<HTMLElement>(`[data-ws-cell="${CSS.escape(cell.id)}"]`)
      if (!el || !table) return
      const r = el.getBoundingClientRect()
      const t = table.getBoundingClientRect()
      const above = r.top - BAR_PX - GAP_PX
      setAt({ left: r.left + r.width / 2, top: above >= t.top ? above : r.top + BELOW_HEADER_PX })
    }
    place()
    window.addEventListener('resize', place)
    table?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      table?.removeEventListener('scroll', place)
    }
  }, [cell, layout, tableRef, frozen])

  if (!at) return null
  const store = useWorkspaceStore.getState
  const active = getActiveTab(cell)
  const split = (side: Side) => {
    setSplitting(false)
    showStructurePreview(null)
    store().splitCell(cell.id, side)
    focusEditItem(cell.id)
  }
  // A move onto the button (not an enter: the toolbar appearing under a resting pointer, after a drop, previews nothing).
  const preview = (side: Side) => (e: React.MouseEvent) => {
    if (e.buttons !== 0 || splitting) return
    const next = splitPreview(layout, cell, side, cellName)
    setSplitting(next != null)
    showStructurePreview(next)
  }
  const unpreview = () => {
    setSplitting(false)
    showStructurePreview(null)
  }

  const swapEntries: MenuEntry[] = otherCards(layout, cell.id).map((c) => ({
    kind: 'item',
    label: cellName(c),
    onSelect: () => {
      store().swapCells(cell.id, c.id)
      focusEditItem(cell.id)
    },
  }))
  const mergeEntries: MenuEntry[] = (['left', 'top', 'right', 'bottom'] as const).flatMap((side) => {
    const other = mergeNeighbour(layout, cell.id, side)
    return other ? [{
      kind: 'item' as const,
      label: `${other.tabs.length > 0 ? `“${cellName(other)}”` : 'The empty slot'} ${SIDE_WORDS[side]}`,
      onSelect: () => {
        store().mergeCells(cell.id, other.id)
        focusEditItem(cell.id)
      },
    }] : []
  })
  const removeLabel = cell.tabs.length > 1 ? 'Remove tab' : 'Remove widget'

  // Portaled to the page: fixed over the table, not one of its grid items (the drop model measures those).
  return createPortal(
    <div className={styles.toolbar} style={{ left: at.left, top: at.top }} role="toolbar" aria-label={`${cellName(cell)} card`} data-edit-toolbar={cell.id}>
      <button type="button" className={styles.button} aria-label="Split side by side" data-tooltip="Split side by side" onMouseMove={preview('right')} onMouseLeave={unpreview} onClick={() => split('right')}>
        <SplitRightIcon />
        <span>Split</span>
      </button>
      <button type="button" className={styles.button} aria-label="Split one above the other" data-tooltip="Split one above the other" onMouseMove={preview('bottom')} onMouseLeave={unpreview} onClick={() => split('bottom')}>
        <SplitBelowIcon />
        <span>Split</span>
      </button>
      <span className={styles.separator} aria-hidden="true" />
      <button
        ref={swapRef}
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={menu === 'swap'}
        disabled={swapEntries.length === 0}
        onClick={() => setMenu((m) => (m === 'swap' ? null : 'swap'))}
      >
        <span>Swap</span>
        <ChevronDownIcon size={12} />
      </button>
      <button
        ref={mergeRef}
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={menu === 'merge'}
        disabled={mergeEntries.length === 0}
        data-tooltip={mergeEntries.length === 0 ? 'No neighbour makes a rectangle with it' : undefined}
        onClick={() => setMenu((m) => (m === 'merge' ? null : 'merge'))}
      >
        <span>Merge</span>
        <ChevronDownIcon size={12} />
      </button>
      <span className={styles.separator} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.button} ${styles.danger}`}
        disabled={!active}
        onClick={() => {
          if (!active) return
          store().removeWidget(active.id)
          focusEditItem(cell.id)
        }}
      >
        <TrashIcon />
        <span>{removeLabel}</span>
      </button>
      {menu === 'swap' && (
        <MenuPopover anchorRef={swapRef} placement="bottom-start" width={240} label="Swap with" entries={[{ kind: 'label', text: 'Swap with' }, ...swapEntries]} onClose={() => setMenu(null)} />
      )}
      {menu === 'merge' && (
        <MenuPopover anchorRef={mergeRef} placement="bottom-start" width={260} label="Merge with" entries={[{ kind: 'label', text: 'Merge with' }, ...mergeEntries]} onClose={() => setMenu(null)} />
      )}
    </div>,
    document.body,
  )
}
