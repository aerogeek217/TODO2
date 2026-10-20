import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { LayoutCell, LayoutTab, WidgetKind } from '../../models/workspace-layout'
import { getActiveTab, tabListId } from '../../models/workspace-layout'
import { useIsListDirty } from '../../hooks/use-list-draft'
import { useSettingsStore } from '../../stores/settings-store'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useTabTitle, useTabTitles } from './widget-hooks'
import { ChevronDownIcon, CloseIcon, PlusIcon, WidgetKindIcon } from '../shared/icons'
import { MenuPopover } from '../shared/MenuPopover'
import { WORKSPACE_TAB_DRAG, workspaceTabDragId, type DraggedTab, type WorkspaceTabDragData } from './workspace-drag'
import { fitTabs, shownTabs, type TabFit, type TabSize } from '../../utils/tab-strip-fit'
import styles from './CellTabStrip.module.css'

/** A tab's widest (the `.tab` rule's `max-width`). */
const TAB_MAX_PX = 160
/** A shrunk tab keeps this much of its title before it is folded into `+N` (the active tab keeps all of it). */
const MIN_TITLE_PX = 48
/** The `+N` button's width before it has been measured. */
const OVERFLOW_FALLBACK_PX = 48

function px(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * A tab's measured sizes, whatever width it has now: its parts but the title
 * (padding, icon, dot, count, close ×, gaps) plus the whole title (its scroll
 * width) — read from the parts, so a tab given more room than it needs never
 * measures wider. The active tab never shrinks.
 */
function measureTab(id: string, el: HTMLElement, active: boolean): TabSize {
  const title = el.querySelector<HTMLElement>('[data-tab-title]')
  if (!title) {
    const box = Math.ceil(el.getBoundingClientRect().width)
    return { id, natural: box, min: box }
  }
  const cs = getComputedStyle(el)
  const parts = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && getComputedStyle(c).display !== 'none')
  let chrome = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth)
    + px(cs.columnGap) * Math.max(0, parts.length - 1)
  for (const part of parts) {
    if (part === title) continue
    const m = getComputedStyle(part)
    chrome += part.getBoundingClientRect().width + px(m.marginLeft) + px(m.marginRight)
  }
  // A title that isn't cut short: its exact width (the scroll width is rounded).
  const fullTitle = title.scrollWidth > title.clientWidth ? title.scrollWidth + 1 : title.getBoundingClientRect().width
  const natural = Math.min(TAB_MAX_PX, Math.ceil(chrome + fullTitle))
  return { id, natural, min: active ? natural : Math.min(natural, Math.ceil(chrome + MIN_TITLE_PX)) }
}

/**
 * The room the header gives the strip: its width less its padding, gaps and
 * the other parts in its row — the panel handle (`data-strip-room`) only at
 * its minimum, as the strip may take the rest of it.
 */
function stripRoom(strip: HTMLElement): number {
  const header = strip.parentElement
  if (!header) return strip.clientWidth
  const cs = getComputedStyle(header)
  let room = header.getBoundingClientRect().width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(cs.paddingLeft) - px(cs.paddingRight)
  let inFlow = 0
  for (const child of Array.from(header.children)) {
    if (!(child instanceof HTMLElement)) continue
    const style = getComputedStyle(child)
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue
    inFlow++
    if (child === strip) continue
    room -= child.hasAttribute('data-strip-room') ? px(style.minWidth) : child.getBoundingClientRect().width
  }
  return room - px(cs.columnGap) * Math.max(0, inFlow - 1)
}

interface TabProps {
  tab: LayoutTab
  active: boolean
  collapsed: boolean
  count?: string
  /** Touch layout: taller tabs, no close ×, not draggable. */
  touch: boolean
  onActivate: () => void
  onClose?: () => void
  onOpenMenu?: (point: { x: number; y: number }) => void
  onFocusSibling: (delta: 1 | -1 | 'first' | 'last') => void
  setRef: (el: HTMLDivElement | null) => void
  /** Folded into `+N`: kept out of sight (and out of the row), only measured. */
  offstage: boolean
  /** Its share of the room while the strip's tabs shrink to fit. */
  size?: CSSProperties
}

function Tab({ tab, active, collapsed, count, touch, onActivate, onClose, onOpenMenu, onFocusSibling, setRef, offstage, size }: TabProps) {
  const title = useTabTitle(tab)
  // A list tab's list, or an Eisenhower tab's (the Eisenhower's own): its unsaved dot.
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  const listUnsaved = useIsListDirty(tabListId(tab, eisenhowerListId))
  const data: WorkspaceTabDragData = { type: WORKSPACE_TAB_DRAG, tabId: tab.id, kind: tab.kind, title }
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: workspaceTabDragId(tab.id), data, disabled: touch })
  const closable = !collapsed && onClose != null

  return (
    <div
      ref={(el) => { setNodeRef(el); setRef(el) }}
      {...(touch ? undefined : attributes)}
      {...(touch ? undefined : listeners)}
      role="tab"
      id={`ws-tab-${tab.id}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-ws-tab={tab.id}
      data-ws-tab-folded={offstage ? '' : undefined}
      aria-hidden={offstage || undefined}
      className={[
        styles.tab,
        active ? styles.active : '',
        collapsed ? styles.flat : '',
        touch ? styles.touch : '',
        isDragging ? styles.dragSource : '',
        offstage ? styles.offstage : '',
      ].join(' ')}
      style={size}
      title={title}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpenMenu?.({ x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onFocusSibling(1) }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onFocusSibling(-1) }
        else if (e.key === 'Home') { e.preventDefault(); onFocusSibling('first') }
        else if (e.key === 'End') { e.preventDefault(); onFocusSibling('last') }
        else if (e.key === 'Delete' && closable) { e.preventDefault(); onClose?.() }
        else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          onOpenMenu?.({ x: r.left, y: r.bottom + 4 })
        }
      }}
    >
      <span className={styles.kindIcon}><WidgetKindIcon kind={tab.kind} size={12} /></span>
      <span className={styles.title} data-tab-title="">{title}</span>
      {listUnsaved && <span className={styles.unsavedDot} role="img" aria-label="unsaved list changes" />}
      {count != null && <span className={styles.count}>{count}</span>}
      {closable && (
        <button
          type="button"
          className={styles.close}
          aria-label={`Close ${title}`}
          title="Close tab"
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onClose?.() }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

/** Ghost tab previewing where a dragged widget lands (end of the strip). */
function GhostTab({ kind, title }: { kind: WidgetKind; title: string }) {
  return (
    <div className={`${styles.tab} ${styles.ghost}`} aria-hidden="true" data-testid="ws-ghost-tab">
      <span className={styles.kindIcon}><WidgetKindIcon kind={kind} size={12} /></span>
      <span className={styles.title}>{title}</span>
    </div>
  )
}

interface CellTabStripProps {
  /** The cell or band whose tabs these are. */
  cell: Pick<LayoutCell, 'tabs' | 'activeTabId'>
  collapsed: boolean
  /** Task count of the active tab (list / Eisenhower: `N`, `shown of total`, or `—`). */
  activeCount?: string
  /** While a tab or a panel is dragged over this panel's middle: the ghost tab(s), at the end of the strip. */
  ghosts?: readonly DraggedTab[] | null
  /**
   * Touch layout (mobile): taller tabs that only switch — not draggable; the
   * close ×, add `+` and tab menu appear only when their handlers are given.
   */
  touch?: boolean
  onActivate: (tabId: string) => void
  onClose?: (tabId: string) => void
  onOpenTabMenu?: (tabId: string, point: { x: number; y: number }) => void
  onAddTab?: (anchor: RefObject<HTMLButtonElement | null>) => void
}

/**
 * The cell header's tab strip: tabs (drag handles, right-click menu, close ×),
 * a `+N` overflow button when they don't fit, and the add-tab `+`. Measured
 * against the room the header gives it (not its own content): tabs show at
 * full width while they fit, then share the room with their titles cut short,
 * and only when that isn't enough do the last ones fold into `+N`. An active
 * tab that would be folded is shown in the last visible place instead.
 */
export function CellTabStrip({
  cell,
  collapsed,
  activeCount,
  ghosts,
  touch = false,
  onActivate,
  onClose,
  onOpenTabMenu,
  onAddTab,
}: CellTabStripProps) {
  const active = getActiveTab(cell)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLButtonElement | null>(null)
  const overflowRef = useRef<HTMLButtonElement | null>(null)
  const overflowWidth = useRef(OVERFLOW_FALLBACK_PX)
  const tabEls = useRef(new Map<string, HTMLDivElement>())
  const [fit, setFit] = useState<{ count: number; shrink: boolean; sizes: readonly TabSize[] }>(
    () => ({ count: cell.tabs.length, shrink: false, sizes: [] }),
  )
  const fitCount = fit.count
  const [overflowOpen, setOverflowOpen] = useState(false)

  // Display order: the active tab moves into the last visible place when it
  // would otherwise be folded. Display only — the layout's order is kept.
  const order = useMemo(() => {
    const shown = shownTabs(cell.tabs, active?.id, fitCount)
    const shownIds = new Set(shown.map((t) => t.id))
    return [...shown, ...cell.tabs.filter((t) => !shownIds.has(t.id))]
  }, [cell.tabs, active?.id, fitCount])
  const hidden = order.slice(Math.max(fitCount, 0))
  const sizeOf = useMemo(() => new Map(fit.sizes.map((s) => [s.id, s])), [fit.sizes])

  const tabKey = cell.tabs.map((t) => t.id).join('|')
  const tabsRef = useLatestRef(cell.tabs)
  const activeId = active?.id
  const hasAdd = !collapsed && onAddTab != null
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const stripGap = px(getComputedStyle(strip).columnGap)
      const tabGap = containerRef.current ? px(getComputedStyle(containerRef.current).columnGap) : stripGap
      const add = addRef.current
      const room = stripRoom(strip) - (add ? add.getBoundingClientRect().width + stripGap : 0)
      const button = overflowRef.current
      if (button) {
        const m = getComputedStyle(button)
        overflowWidth.current = button.getBoundingClientRect().width + px(m.marginLeft) + px(m.marginRight)
      }
      const sizes = tabsRef.current.flatMap((t) => {
        const el = tabEls.current.get(t.id)
        return el ? [measureTab(t.id, el, t.id === activeId)] : []
      })
      const next: TabFit = fitTabs(sizes, activeId, room, overflowWidth.current + stripGap, tabGap)
      setFit((prev) => (
        prev.count === next.count && prev.shrink === next.shrink && sameSizes(prev.sizes, sizes)
          ? prev
          : { ...next, sizes }
      ))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(strip)
    if (strip.parentElement) ro.observe(strip.parentElement)
    for (const el of tabEls.current.values()) ro.observe(el)
    return () => ro.disconnect()
    // Re-observe when the tabs, the active one or the header's parts change (the tabs are read through a ref).
  }, [tabKey, tabsRef, activeId, hasAdd, collapsed])

  const focusSibling = (fromId: string, delta: 1 | -1 | 'first' | 'last') => {
    const ids = order.map((t) => t.id)
    const i = ids.indexOf(fromId)
    const n = ids.length
    const next = delta === 'first' ? 0 : delta === 'last' ? n - 1 : (i + delta + n) % n
    const id = ids[next]
    if (!id) return
    onActivate(id)
    queueMicrotask(() => tabEls.current.get(id)?.focus())
  }

  return (
    <div ref={stripRef} className={styles.strip}>
      <div ref={containerRef} className={styles.tabs} role="tablist" aria-label="Widgets">
        {order.map((tab, i) => (
          <Tab
            key={tab.id}
            tab={tab}
            offstage={i >= Math.max(fitCount, 0)}
            size={fit.shrink && i < fitCount ? shareOf(sizeOf.get(tab.id)) : undefined}
            active={tab.id === active?.id}
            collapsed={collapsed}
            touch={touch}
            count={tab.id === active?.id ? activeCount : undefined}
            onActivate={() => onActivate(tab.id)}
            onClose={onClose ? () => onClose(tab.id) : undefined}
            onOpenMenu={onOpenTabMenu ? (p) => onOpenTabMenu(tab.id, p) : undefined}
            onFocusSibling={(d) => focusSibling(tab.id, d)}
            setRef={(el) => {
              if (el) tabEls.current.set(tab.id, el)
              else tabEls.current.delete(tab.id)
            }}
          />
        ))}
        {ghosts?.map((g) => <GhostTab key={g.id} kind={g.kind} title={g.title} />)}
      </div>
      {hidden.length > 0 && (
        <button
          ref={overflowRef}
          type="button"
          className={styles.overflow}
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          aria-label={`${hidden.length} more tabs`}
          onClick={() => setOverflowOpen((o) => !o)}
        >
          +{hidden.length}
          <ChevronDownIcon />
        </button>
      )}
      {!collapsed && onAddTab && (
        <button
          ref={addRef}
          type="button"
          className={styles.add}
          aria-label="Add widget as tab"
          title="Add widget as tab"
          aria-haspopup="menu"
          onClick={() => onAddTab(addRef)}
        >
          <PlusIcon />
        </button>
      )}
      {overflowOpen && (
        <OverflowMenu
          anchorRef={overflowRef}
          tabs={hidden}
          onPick={(id) => onActivate(id)}
          onClose={() => setOverflowOpen(false)}
        />
      )}
    </div>
  )
}

function sameSizes(a: readonly TabSize[], b: readonly TabSize[]): boolean {
  return a.length === b.length && a.every((s, i) => {
    const t = b[i]
    return t != null && s.id === t.id && s.natural === t.natural && s.min === t.min
  })
}

/** A shown tab's share of the room while the tabs shrink: equal shares, each between its least and its full width. */
function shareOf(size: TabSize | undefined): CSSProperties | undefined {
  if (!size) return undefined
  // 1 px over the measured full width, so rounding never cuts a title that fits.
  return { flex: '1 1 0px', minWidth: size.min, maxWidth: size.natural + 1 }
}

function OverflowMenu({ anchorRef, tabs, onPick, onClose }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  tabs: LayoutTab[]
  onPick: (tabId: string) => void
  onClose: () => void
}) {
  // The strip's own titles: a list's unsaved name included.
  const titles = useTabTitles(tabs)
  const entries = tabs.map((tab, i) => ({
    kind: 'item' as const,
    label: titles[i] ?? '',
    icon: <WidgetKindIcon kind={tab.kind} />,
    onSelect: () => onPick(tab.id),
  }))
  return <MenuPopover anchorRef={anchorRef} placement="bottom-end" entries={entries} label="More tabs" onClose={onClose} />
}
