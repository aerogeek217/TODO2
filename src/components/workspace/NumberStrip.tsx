import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { LayoutCell, LayoutTab } from '../../models/workspace-layout'
import { WidgetFaceContext } from '../../hooks/use-widget-face'
import { trackHot } from '../../utils/hot-attr'
import type { WidgetFace } from '../../utils/widget-face'
import { PlusIcon } from '../shared/icons'
import { CellControlsContext, type CellControlsValue } from './cell-controls'
import { smallFaceClick, useCellFace, useHeldBodyHeight } from './cell-face'
import { OpenLargerPlaceholder } from './OpenLargerPlaceholder'
import { CellControls } from './WidgetTopLine'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { useTabTitle } from './widget-hooks'
import { WORKSPACE_TAB_DRAG, workspaceTabDragId, type WorkspaceTabDragData } from './workspace-drag'
import styles from './NumberStrip.module.css'

/** A strip's slot never collapses on its own (its cell's row does): no Expand. */
const NOOP = () => {}

/** On a strip's slot while hovered or holding the focus: its own controls show by it (not the whole cell's hover). */
const SLOT_HOT_ATTR = 'data-slot-hot'

/** Marks a strip's slot with its tab id: the right-click, Shift+F10 and the drop geometry find a slot's tab by it. */
export const NUMBER_SLOT_ATTR = 'data-number-slot'

interface NumberStripProps {
  cell: LayoutCell
  /** A fit row's (or a collapsed one's): every Number at its small face. */
  smallFaces: boolean
  /** A drag is on: a small face's click opens nothing. */
  dragging: boolean
  /** The tab whose ⋯ menu is open, if one of this strip's. */
  menuTabId: string | null
  /** A slot's ⋯ was pressed: its menu, under its button. */
  onMore: (tabId: string, button: HTMLButtonElement | null) => void
  onClose: (tabId: string) => void
  onAdd: () => void
  onResult: (tabId: string, result: WidgetResult) => void
  /** The face each slot draws, for the menu's Open larger. */
  onFace: (tabId: string, face: WidgetFace) => void
}

/**
 * A cell of only Numbers, two or more (flair P10, `isNumberStripCell`): its
 * Numbers side by side, evenly divided — wrapping onto another line when
 * they can't each keep their 72px — with no tab strip. Each is a slot of its
 * own: its face, its ⋯ and Open larger (its own controls, shown on its own
 * hover), its × and a drag of its own (a tab's: reorder in the strip; out
 * of it only in the layout edit mode, where the card drags the whole
 * strip). A `+` at the strip's end adds a Number.
 */
export function NumberStrip({ cell, smallFaces, dragging, menuTabId, onMore, onClose, onAdd, onResult, onFace }: NumberStripProps) {
  return (
    <div className={styles.strip} data-number-strip={cell.id}>
      {cell.tabs.map((tab) => (
        <NumberSlot
          key={tab.id}
          cell={cell}
          tab={tab}
          smallFaces={smallFaces}
          dragging={dragging}
          menuOpen={menuTabId === tab.id}
          onMore={onMore}
          onClose={onClose}
          onResult={onResult}
          onFace={onFace}
        />
      ))}
      <button
        type="button"
        className={styles.add}
        aria-label="Add number"
        data-tooltip="Add number"
        onClick={(e) => {
          e.preventDefault()
          onAdd()
        }}
      >
        <PlusIcon size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

function NumberSlot({ cell, tab, smallFaces, dragging, menuOpen, onMore, onClose, onResult, onFace }: {
  cell: LayoutCell
  tab: LayoutTab
  smallFaces: boolean
  dragging: boolean
  menuOpen: boolean
  onMore: (tabId: string, button: HTMLButtonElement | null) => void
  onClose: (tabId: string) => void
  onResult: (tabId: string, result: WidgetResult) => void
  onFace: (tabId: string, face: WidgetFace) => void
}) {
  const title = useTabTitle(tab)
  const face = useCellFace(tab, { forced: smallFaces ? 'small' : undefined })
  useEffect(() => { onFace(tab.id, face.face) }, [onFace, tab.id, face.face])
  const [setHeldBody, heldHeight] = useHeldBodyHeight(tab.id, smallFaces)

  // A tab's drag (reorder in the strip, move out): the slot itself, past dnd-kit's 5px — a click is still a click.
  const data: WorkspaceTabDragData = { type: WORKSPACE_TAB_DRAG, tabId: tab.id, kind: tab.kind, title, ...(tab.icon ? { icon: tab.icon } : {}) }
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: workspaceTabDragId(tab.id), data })
  const setSlot = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el)
    return trackHot(el, SLOT_HOT_ATTR, { hover: true, focus: true })
  }, [setNodeRef])

  const moreRef = useRef<HTMLButtonElement | null>(null)
  /** The Number's top lines mounted: with none (a compact placeholder), the slot's controls stand for its tab. */
  const [lines, setLines] = useState(0)
  const claim = useCallback(() => {
    setLines((n) => n + 1)
    return () => setLines((n) => n - 1)
  }, [])
  // Memoized, as FilledCell's: every consumer of the context re-renders when it changes.
  const opensLarger = face.opensLarger
  const openLarger = face.openLarger
  const controls = useMemo<CellControlsValue>(() => ({
    cellId: cell.id,
    tabs: cell.tabs,
    tabId: tab.id,
    title,
    touch: false,
    setMoreButton: (el) => {
      moreRef.current = el
      return undefined
    },
    menuOpen,
    onMore: () => onMore(tab.id, moreRef.current),
    ...(opensLarger ? { onOpenLarger: openLarger } : {}),
    collapsed: false,
    onExpand: NOOP,
    claim,
  }), [cell.id, cell.tabs, tab.id, title, menuOpen, onMore, opensLarger, openLarger, claim])
  const tabId = tab.id
  const slotResult = useCallback((result: WidgetResult) => onResult(tabId, result), [onResult, tabId])
  const small = face.face === 'small'

  return (
    <div
      ref={setSlot}
      {...listeners}
      className={`${styles.slot} ${isDragging ? styles.dragSource : ''}`}
      {...{ [NUMBER_SLOT_ATTR]: tab.id }}
    >
      <div
        ref={setHeldBody}
        className={`${styles.body} ${small ? styles.bodySmall : ''}`}
        // A small face opens its widget larger (a widget's own click goes first).
        onClick={dragging ? undefined : smallFaceClick(face)}
      >
        <CellControlsContext.Provider value={controls}>
          <WidgetFaceContext.Provider value={face.host}>
            {face.open ? (
              // The popup shows this tab: its one live widget is there.
              <OpenLargerPlaceholder tabId={tab.id} title={title} compact={small} minHeight={heldHeight} />
            ) : (
              <WidgetBody key={tab.id} tab={tab} onResult={slotResult} />
            )}
          </WidgetFaceContext.Provider>
        </CellControlsContext.Provider>
      </div>
      <CellControls value={controls} floating standsForTab={lines === 0} />
      <button
        type="button"
        className={styles.close}
        aria-label={`Remove “${title}”`}
        data-tooltip={`Remove “${title}”`}
        onClick={(e) => {
          e.preventDefault()
          onClose(tab.id)
        }}
      >
        ×
      </button>
    </div>
  )
}
