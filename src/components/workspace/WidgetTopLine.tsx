import { Children, useContext, useLayoutEffect, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { tabTopLineIcon } from '../../models/workspace-layout'
import { useSettingsStore } from '../../stores/settings-store'
import { AppIcon } from '../shared/AppIcon'
import { ExpandIcon, MoreIcon } from '../shared/icons'
import type { TooltipLegendItem } from '../shared/TooltipBubble'
import { useTooltip } from '../shared/use-tooltip'
import { OPEN_LARGER_LABEL } from '../shared/widget-kind-menu-entries'
import { CellControlsContext, TOP_LINE_ATTR, type CellControlsValue } from './cell-controls'
import { TrackExpandButton } from './TrackExpandButton'
import styles from './WidgetTopLine.module.css'

/**
 * A cell's controls slot (D26 AA1): Open larger (where the widget offers it) and the ⋯ (the
 * widget's menu) — shown while the pointer is over the
 * cell, while focus is in it and while a menu of the cell is open, always on
 * touch; hidden, they take no press — and, while its row is
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
  const { setMoreButton, menuOpen, touch, collapsed, onExpand, onMore, tabId, onOpenLarger } = value
  const moreOpen = value.moreOpen ?? menuOpen
  const stop = (e: MouseEvent) => {
    // The body's small-face click (it opens the widget larger) is not this one.
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
        <TrackExpandButton axis="rows" touch={touch} className={styles.expand} onClick={(e) => { stop(e); onExpand() }} />
      )}
      <span className={styles.controls}>
        {!touch && onOpenLarger && (
          <button
            type="button"
            className={styles.button}
            aria-label={OPEN_LARGER_LABEL}
            aria-haspopup="dialog"
            data-tooltip={OPEN_LARGER_LABEL}
            data-testid="open-larger"
            onClick={(e) => { stop(e); onOpenLarger() }}
          >
            <ExpandIcon size={13} />
          </button>
        )}
        <button
          ref={setMoreButton}
          type="button"
          className={`${styles.button} ${moreOpen ? styles.pressed : ''}`}
          aria-label="Cell options"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          data-tooltip="Cell options"
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
  /** `false`: no picked icon before the lead (J2) — a line that draws the tab's icon itself (a list's small face). */
  leadIcon?: boolean
  children?: ReactNode
  'data-testid'?: string
}

/**
 * A widget's top line (D26 AA1): its first line — a list's filter line, the
 * calendar's header, a Number's label, a chart's title — which, while the
 * widget is alone in its cell (no tab strip), names it (`lead`) and holds the
 * cell's controls slot (Open larger and the ⋯, `CellControls`). A right-click on it
 * or Shift+F10 / the Menu key in it opens the cell's ⋯ menu (the cell's
 * handlers, by `data-widget-top-line`); it stands for the tab
 * (`data-ws-tab`) the strip would show. Elsewhere (a strip names the widget,
 * the widget popup, Settings) it is just the line.
 */
export function WidgetTopLine({ as = 'div', className, style, lead, controls = 'inline', alone = false, leadIcon = true, children, ...rest }: WidgetTopLineProps) {
  const value = useContext(CellControlsContext)
  const inline = value != null && controls === 'inline'
  // Before paint: the cell drops its own floating controls in the same frame.
  const claim = value?.claim
  useLayoutEffect(() => (claim ? claim(inline) : undefined), [inline, claim])
  if (alone && value == null) return null
  const Tag = as
  // J2: alone in its cell, a picked icon leads the name; a tab never given one shows none here.
  const lineTab = value?.tabs.find((t) => t.id === value.tabId)
  const icon = lineTab && leadIcon ? tabTopLineIcon(lineTab) : undefined
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
      {value != null && icon && <AppIcon icon={icon} size={13} className={styles.leadIcon} />}
      {value != null && lead}
      {children}
      {inline && <CellControls value={value} />}
    </Tag>
  )
}

/**
 * A slim name line (Notes, the Neglect map): the widget's
 * name — its tab's title, a name given in Name and icon… included; `name`
 * outside a cell — and `children` after it. Alone in its cell only.
 * Settings › Show widget names off (the default): no name — the line holds
 * only its `children` (the legend their tooltip), and with none it isn't
 * drawn, so the cell's controls float over its corner.
 */
export function WidgetNameLine({ name, legend, children }: {
  name: string
  /** What the widget's marks mean: the name's tooltip (a map's colors and shapes). */
  legend?: readonly TooltipLegendItem[]
  children?: ReactNode
}) {
  const value = useContext(CellControlsContext)
  const showName = useSettingsStore((s) => s.showWidgetNames)
  const title = value?.title || name
  const { triggerProps, tooltip } = useTooltip(legend ? title : null, { legend })
  if (!showName) {
    if (Children.toArray(children).length === 0) return null
    return (
      <WidgetTopLine alone className={styles.nameLine}>
        {legend
          ? <span className={styles.legendHost} data-legend="true" {...triggerProps}>{children}{tooltip}</span>
          : children}
      </WidgetTopLine>
    )
  }
  return (
    <WidgetTopLine
      alone
      className={styles.nameLine}
      lead={<span className={styles.name} data-testid="top-line-name" data-legend={legend ? 'true' : undefined} {...triggerProps}>{title}{tooltip}</span>}
    >
      {children}
    </WidgetTopLine>
  )
}

/** A top line's name part (`lead`): the widget's name, cut short with an ellipsis. */
export function TopLineName({ children, title }: { children: ReactNode; title?: string }) {
  return <span className={styles.name} data-tooltip={title} data-testid="top-line-name">{children}</span>
}
