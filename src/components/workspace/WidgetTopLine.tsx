import { useContext, useLayoutEffect, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronDownIcon, GripIcon, MoreIcon } from '../shared/icons'
import { CellControlsContext, TOP_LINE_ATTR, type CellControlsValue } from './cell-controls'
import { useTabTitles } from './widget-hooks'
import { WORKSPACE_PANEL_DRAG, workspacePanelDragId, type WorkspacePanelDragData } from './workspace-drag'
import styles from './WidgetTopLine.module.css'

/**
 * The grip: drags the whole cell (5px to start, as a tab), as the strip's
 * panel handle does. Not focusable — the ⋯ menu's Split, Merge and Insert
 * are the keyboard way.
 */
function Grip({ value }: { value: CellControlsValue }) {
  const titles = useTabTitles(value.tabs)
  const data: WorkspacePanelDragData = {
    type: WORKSPACE_PANEL_DRAG,
    panelId: value.cellId,
    tabs: value.tabs.map((t, i) => ({ id: t.id, kind: t.kind, title: titles[i] ?? '' })),
  }
  const { setNodeRef, listeners } = useDraggable({ id: workspacePanelDragId(value.cellId), data })
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      className={styles.grip}
      data-ws-panel-handle={value.cellId}
      data-testid="ws-cell-grip"
      title={`Drag to move “${value.title}”`}
      aria-hidden="true"
      // A small face's body opens its full widget on a click: not one ending a grab.
      onClick={(e) => e.preventDefault()}
    >
      <GripIcon />
    </span>
  )
}

/**
 * A cell's controls slot (D26 AA1): the grip and the ⋯ — shown while the
 * pointer is over the cell, while focus is in it and while its menu is open,
 * always on touch (no grip there) — and, while its row is collapsed, an
 * Expand button that always shows. In a widget's top line, or (`floating`)
 * the cell's own over its top-right corner, for a face without a top line
 * that holds it.
 */
export function CellControls({ value, floating = false }: { value: CellControlsValue; floating?: boolean }) {
  const { setMoreButton, menuOpen, touch, collapsed, onExpand, onMore } = value
  const stop = (e: MouseEvent) => {
    // The body's small-face click (it opens the full widget) is not this one.
    e.preventDefault()
  }
  return (
    <span className={`${styles.slot} ${floating ? styles.floating : ''}`} data-cell-controls="" data-open={menuOpen ? '' : undefined} data-touch={touch ? '' : undefined}>
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
        {!touch && <Grip value={value} />}
        <button
          ref={setMoreButton}
          type="button"
          className={`${styles.button} ${menuOpen ? styles.pressed : ''}`}
          aria-label="Cell options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
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
  /** Shown only alone in its cell: a slim name line (Notes, the Eisenhower, the Neglect map). */
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
  useLayoutEffect(() => (inline ? value.claim() : undefined), [inline, value])
  if (alone && value == null) return null
  const Tag = as
  return (
    <Tag
      className={[styles.topLine, className ?? ''].join(' ')}
      style={style}
      {...{ [TOP_LINE_ATTR]: '' }}
      data-ws-tab={value?.tabId}
      data-testid={rest['data-testid']}
    >
      {value != null && lead}
      {children}
      {inline && <CellControls value={value} />}
    </Tag>
  )
}

/** A slim name line (Notes, the Eisenhower, the Neglect map): the widget's name, and `children` after it. Alone in its cell only. */
export function WidgetNameLine({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <WidgetTopLine alone className={styles.nameLine} lead={<span className={styles.name}>{name}</span>}>
      {children}
    </WidgetTopLine>
  )
}

/** A top line's name part (`lead`): the widget's name, cut short with an ellipsis. */
export function TopLineName({ children, title }: { children: ReactNode; title?: string }) {
  return <span className={styles.name} title={title} data-testid="top-line-name">{children}</span>
}
