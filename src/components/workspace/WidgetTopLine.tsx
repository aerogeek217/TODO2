import { useCallback, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import type { LayoutTab } from '../../models/workspace-layout'
import { ChevronDownIcon, GripIcon, MoreIcon } from '../shared/icons'
import { CellControlsContext, TOP_LINE_ATTR, type CellControlsValue } from './cell-controls'
import { useTabTitles } from './widget-hooks'
import { WORKSPACE_PANEL_DRAG, workspacePanelDragId, type WorkspacePanelDragData } from './workspace-drag'
import styles from './WidgetTopLine.module.css'

/** The grip's name (its button's and its menu's: `cell-menu.CELL_MENU_LABEL.layout`). */
export const CELL_GRIP_LABEL = 'Cell layout'

interface CellGripProps {
  cellId: string
  /** The cell's tabs, for the drag's data (and the ghost's words). */
  tabs: readonly LayoutTab[]
  /** The active widget's title (the tooltip's words). */
  title: string
  /**
   * The draggable's id after the cell's panel id (`:floating`, `:header`):
   * dnd-kit keeps one node per id, and a cell can draw two grips for a
   * moment (its own floating one beside a top line's before that one claims
   * the slot), or a grip beside the strip's panel handle.
   */
  idSuffix?: string
  /** Its menu is open. */
  expanded: boolean
  /** Opens (or closes) the cell's layout menu under it. */
  onMenu: () => void
  /** Takes the button (a callback ref, with its cleanup): the menu opens under it. */
  setButton?: (el: HTMLButtonElement | null) => (() => void) | undefined
  /** Marks it as the cell's drag handle (`data-ws-panel-handle`) — not beside the strip's own handle. */
  panelHandle?: boolean
  className?: string
}

/**
 * A cell's grip (UX cleanup 4A): a button. A drag (5px to start, as a tab)
 * moves the whole cell, as the strip's panel handle does, and opens
 * nothing; a click — or Enter / Space — opens the cell's layout menu (Split
 * cell, Merge with, Insert, Collapse row, Close …). A press that dragged the
 * cell is never a click here, even when it ends back on the grip: dnd-kit
 * swallows the click that ends a drag, and the grip also ignores a click
 * after it was dragged (a drag cancelled with Esc, released later) or one
 * landing 5px or more from where it was pressed.
 */
export function CellGrip({ cellId, tabs, title, idSuffix = '', expanded, onMenu, setButton, panelHandle = false, className }: CellGripProps) {
  const titles = useTabTitles(tabs)
  const data: WorkspacePanelDragData = {
    type: WORKSPACE_PANEL_DRAG,
    panelId: cellId,
    tabs: tabs.map((t, i) => ({ id: t.id, kind: t.kind, title: titles[i] ?? '' })),
  }
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${workspacePanelDragId(cellId)}${idSuffix}`, data })
  /** Where the press began, and whether it went on to drag the cell. */
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  useEffect(() => {
    if (isDragging && press.current) press.current.dragged = true
  }, [isDragging])
  const ref = useCallback((el: HTMLButtonElement | null) => {
    setNodeRef(el)
    const off = setButton?.(el)
    return () => {
      off?.()
      setNodeRef(null)
    }
  }, [setNodeRef, setButton])
  return (
    <button
      ref={ref}
      type="button"
      className={className ?? styles.grip}
      data-ws-panel-handle={panelHandle ? cellId : undefined}
      data-testid="ws-cell-grip"
      aria-label={CELL_GRIP_LABEL}
      aria-haspopup="menu"
      aria-expanded={expanded}
      title={`${CELL_GRIP_LABEL} · drag to move “${title}”`}
      onPointerDown={(e) => {
        press.current = { x: e.clientX, y: e.clientY, dragged: false }
        listeners?.onPointerDown?.(e)
      }}
      onClick={(e) => {
        // A small face's body opens its full widget on a click: not this one.
        e.preventDefault()
        const p = press.current
        press.current = null
        // `detail` 0: Enter / Space (no press to measure).
        if (e.detail > 0 && p && (p.dragged || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_ACTIVATION_DISTANCE_PX)) return
        onMenu()
      }}
    >
      <GripIcon />
    </button>
  )
}

/**
 * A cell's controls slot (D26 AA1): the grip (its layout menu, UX cleanup
 * 4A) and the ⋯ (the widget's menu) — shown while the pointer is over the
 * cell, while focus is in it and while a menu of the cell is open, always on
 * touch (no grip there); hidden, they take no press — and, while its row is
 * collapsed, an Expand button that always shows. In a widget's top line, or
 * (`floating`) the cell's own over its top-right corner, for a face without
 * a top line that holds it.
 */
export function CellControls({ value, floating = false, standsForTab = false }: {
  value: CellControlsValue
  floating?: boolean
  /** No top line in the widget's face: the slot is its top line (`data-ws-tab`, its right-click and Shift+F10 the menu). */
  standsForTab?: boolean
}) {
  const { setMoreButton, menuOpen, touch, collapsed, onExpand, onMore, tabId, onGrip } = value
  const moreOpen = value.moreOpen ?? menuOpen
  const stop = (e: MouseEvent) => {
    // The body's small-face click (it opens the full widget) is not this one.
    e.preventDefault()
  }
  return (
    <span
      className={`${styles.slot} ${floating ? styles.floating : ''}`}
      data-cell-controls=""
      data-open={menuOpen ? '' : undefined}
      data-touch={touch ? '' : undefined}
      {...(standsForTab ? { [TOP_LINE_ATTR]: '', 'data-ws-tab': tabId } : {})}
    >
      {collapsed && (
        <button
          type="button"
          className={styles.button}
          aria-label="Expand row"
          aria-expanded={false}
          title="Expand row"
          onClick={(e) => { stop(e); onExpand() }}
        >
          <ChevronDownIcon size={14} />
        </button>
      )}
      <span className={styles.controls}>
        {!touch && onGrip && (
          <CellGrip
            cellId={value.cellId}
            tabs={value.tabs}
            title={value.title}
            idSuffix={floating ? ':floating' : ''}
            expanded={value.gripOpen === true}
            onMenu={onGrip}
            setButton={value.setGripButton}
            panelHandle
            className={`${styles.grip} ${value.gripOpen ? styles.pressed : ''}`}
          />
        )}
        <button
          ref={setMoreButton}
          type="button"
          className={`${styles.button} ${moreOpen ? styles.pressed : ''}`}
          aria-label="Cell options"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          title="Cell options"
          onClick={(e) => { stop(e); onMore() }}
        >
          <MoreIcon size={touch ? 16 : 14} />
        </button>
      </span>
    </span>
  )
}

interface WidgetTopLineProps {
  /** The element it is (`span` inside a button's content: a Number's label row). */
  as?: 'div' | 'span' | 'header'
  className?: string
  style?: CSSProperties
  /** What it shows only alone in its cell, before its content: the widget's name (a strip names it otherwise). */
  lead?: ReactNode
  /**
   * Where the controls slot goes: at the line's end (`inline`), or the
   * cell's own over its corner (`cell`) — a line inside a button (a Number's)
   * can't hold buttons.
   */
  controls?: 'inline' | 'cell'
  /** Shown only alone in its cell: a slim name line (Notes, the Neglect map). */
  alone?: boolean
  children?: ReactNode
  'data-testid'?: string
}

/**
 * A widget's top line (D26 AA1): its first line — a list's filter line, the
 * calendar's header, a Number's label, a chart's title — which, while the
 * widget is alone in its cell (no tab strip), names it (`lead`) and holds the
 * cell's controls slot (the grip and ⋯, `CellControls`). A right-click on it
 * or Shift+F10 / the Menu key in it opens the cell's ⋯ menu (the cell's
 * handlers, by `data-widget-top-line`); it stands for the tab
 * (`data-ws-tab`) the strip would show. Elsewhere (a strip names the widget,
 * the small face's popover, Settings) it is just the line.
 */
export function WidgetTopLine({ as = 'div', className, style, lead, controls = 'inline', alone = false, children, ...rest }: WidgetTopLineProps) {
  const value = useContext(CellControlsContext)
  const inline = value != null && controls === 'inline'
  // Before paint: the cell drops its own floating controls in the same frame.
  const claim = value?.claim
  useLayoutEffect(() => (claim ? claim(inline) : undefined), [inline, claim])
  if (alone && value == null) return null
  const Tag = as
  return (
    <Tag
      className={[styles.topLine, className ?? ''].join(' ')}
      style={style}
      {...{ [TOP_LINE_ATTR]: '' }}
      data-ws-tab={value?.tabId}
      // Standing for the tab, it takes the focus a closing surface hands back to the tab (Edit list, the face
      // popover) — not inside a button (a Number's label).
      tabIndex={inline ? -1 : undefined}
      data-testid={rest['data-testid']}
    >
      {value != null && lead}
      {children}
      {inline && <CellControls value={value} />}
    </Tag>
  )
}

/**
 * A slim name line (Notes, the Neglect map): the widget's
 * name and `children` after it. Alone in its cell only.
 */
export function WidgetNameLine({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <WidgetTopLine
      alone
      className={styles.nameLine}
      lead={<span className={styles.name} data-testid="top-line-name">{name}</span>}
    >
      {children}
    </WidgetTopLine>
  )
}

/** A top line's name part (`lead`): the widget's name, cut short with an ellipsis. */
export function TopLineName({ children, title }: { children: ReactNode; title?: string }) {
  return <span className={styles.name} title={title} data-testid="top-line-name">{children}</span>
}
