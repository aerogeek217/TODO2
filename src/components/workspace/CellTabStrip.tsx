import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { LayoutCell, LayoutTab, WidgetKind } from '../../models/workspace-layout'
import { getActiveTab } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { KIND_LABEL } from '../../utils/slot-kind'
import { useTabTitle } from './widget-hooks'
import { ChevronDownIcon, CloseIcon, PlusIcon, WidgetKindIcon } from './icons'
import { MenuPopover } from './MenuPopover'
import { WORKSPACE_TAB_DRAG, workspaceTabDragId, type WorkspaceTabDragData } from './workspace-drag'
import styles from './CellTabStrip.module.css'

interface TabProps {
  tab: LayoutTab
  active: boolean
  collapsed: boolean
  count?: number
  /** Touch layout: taller tabs, no close ×, not draggable. */
  touch: boolean
  onActivate: () => void
  onClose?: () => void
  onOpenMenu?: (point: { x: number; y: number }) => void
  onFocusSibling: (delta: 1 | -1 | 'first' | 'last') => void
  setRef: (el: HTMLDivElement | null) => void
}

function Tab({ tab, active, collapsed, count, touch, onActivate, onClose, onOpenMenu, onFocusSibling, setRef }: TabProps) {
  const title = useTabTitle(tab)
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
      className={[
        styles.tab,
        active ? styles.active : '',
        collapsed ? styles.flat : '',
        touch ? styles.touch : '',
        isDragging ? styles.dragSource : '',
      ].join(' ')}
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
      <span className={styles.title}>{title}</span>
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
  cell: LayoutCell
  collapsed: boolean
  /** Task count of the active list tab. */
  activeCount?: number
  /** While a tab is dragged over this cell's middle zone: the ghost tab. */
  ghost?: { kind: WidgetKind; title: string } | null
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
 * a `+N` overflow button when they don't fit, and the add-tab `+`. An active
 * tab that would be clipped is shown in the last visible place instead.
 */
export function CellTabStrip({
  cell,
  collapsed,
  activeCount,
  ghost,
  touch = false,
  onActivate,
  onClose,
  onOpenTabMenu,
  onAddTab,
}: CellTabStripProps) {
  const active = getActiveTab(cell)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLButtonElement | null>(null)
  const overflowRef = useRef<HTMLButtonElement | null>(null)
  const tabEls = useRef(new Map<string, HTMLDivElement>())
  const [fitCount, setFitCount] = useState(cell.tabs.length)
  const [overflowOpen, setOverflowOpen] = useState(false)

  // Display order: the active tab moves into the last visible place when it
  // would otherwise be clipped. Display only — the layout's order is kept.
  const order = useMemo(() => {
    const idx = cell.tabs.findIndex((t) => t.id === active?.id)
    if (!active || idx < fitCount || fitCount <= 0) return cell.tabs
    const rest = cell.tabs.filter((t) => t.id !== active.id)
    return [...rest.slice(0, fitCount - 1), active, ...rest.slice(fitCount - 1)]
  }, [cell.tabs, active, fitCount])
  const hidden = order.slice(Math.max(fitCount, 0))

  const tabKey = cell.tabs.map((t) => t.id).join('|')
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const avail = container.clientWidth
      let used = 0
      let n = 0
      for (const t of cell.tabs) {
        const el = tabEls.current.get(t.id)
        // 2px flex gap between tabs
        const w = (el ? el.offsetWidth : 0) + (n > 0 ? 2 : 0)
        if (used + w > avail + 1) break
        used += w
        n++
      }
      setFitCount((prev) => (prev === n ? prev : n))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    for (const el of tabEls.current.values()) ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-observe when the set of tabs changes
  }, [tabKey])

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
    <div className={styles.strip}>
      <div ref={containerRef} className={styles.tabs} role="tablist" aria-label="Widgets">
        {order.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === active?.id}
            collapsed={collapsed}
            touch={touch}
            count={tab.id === active?.id && tab.kind === 'lens' ? activeCount : undefined}
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
        {ghost && <GhostTab kind={ghost.kind} title={ghost.title} />}
        {hidden.length > 0 && <span className={styles.fade} aria-hidden="true" />}
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

function OverflowMenu({ anchorRef, tabs, onPick, onClose }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  tabs: LayoutTab[]
  onPick: (tabId: string) => void
  onClose: () => void
}) {
  const names = useListDefinitionStore((s) => s.listDefinitions)
  const entries = tabs.map((tab) => {
    const label = tab.kind === 'lens'
      ? (names.find((d) => d.id === tab.config.listDefinitionId)?.name ?? 'List')
      : KIND_LABEL[tab.kind]
    return { kind: 'item' as const, label, icon: <WidgetKindIcon kind={tab.kind} />, onSelect: () => onPick(tab.id) }
  })
  return <MenuPopover anchorRef={anchorRef} placement="bottom-end" entries={entries} label="More tabs" onClose={onClose} />
}
