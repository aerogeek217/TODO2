import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { getActiveTab, type LayoutCell, type LayoutColumn, type WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUIStore } from '../../stores/ui-store'
import { indicatorBox, pageOffset, pagerPosition } from '../../utils/column-pager'
import { CellTabStrip } from './CellTabStrip'
import { WidgetBody } from './WidgetBody'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import { UnsavedPrompt } from './UnsavedPrompt'
import { SaveListButton } from './list/SaveListButton'
import type { ListWidgetResult } from './list/ListWidget'
import { pointBelow } from './list/popover-point'
import { useIsListDirty, useUnsavedListIds } from '../../stores/list-draft-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { copyTasksRich } from '../../services/task-copy'
import { useTabTitle } from './widget-hooks'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, LayoutIcon, MoreIcon } from './icons'
import styles from './MobileWorkspaceView.module.css'

/** Gap between columns in the pager (px). */
const PAGER_GAP_PX = 8
/** The strip underline sits under the name, inside the button's side padding. */
const STRIP_ITEM_PADDING_PX = 12

const WIDER_SCREEN_HINT = 'To create or edit layouts, use a wider screen.'

/** A column's name: the active tab title of its first cell. */
function useColumnName(column: LayoutColumn, index: number): string {
  const first = column.cells[0]
  const title = useTabTitle(first ? getActiveTab(first) : undefined)
  return title || `Column ${index + 1}`
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.2" y2="16.2" />
    </svg>
  )
}

/** Bottom sheet for switching layouts. Switching only: layouts are created and edited on a wider screen. */
function LayoutSheet({ onClose }: { onClose: () => void }) {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const isDirty = useWorkspaceStore((s) => s.isDirty)
  const unsavedLists = useUnsavedListIds()
  const [pending, setPending] = useState<{ id: number; name: string } | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    sheetRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"], button')?.focus()
  }, [])

  const pick = (id: number, name: string) => {
    if (id === activeLayoutId) { onClose(); return }
    // Unsaved changes can only come from a wider screen in this session; still never lose them silently.
    if (useWorkspaceStore.getState().isDirty || unsavedLists.length > 0) { setPending({ id, name }); return }
    void useWorkspaceStore.getState().load(id)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !pending) { e.stopPropagation(); onClose() }
  }

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-layout-sheet-title"
        onKeyDown={onKeyDown}
      >
        <span className={styles.handle} aria-hidden="true" />
        <h2 id="ws-layout-sheet-title" className={styles.sheetTitle}>Layouts</h2>
        <div className={styles.sheetRows}>
          {layouts.map((l) => {
            const current = l.id === activeLayoutId
            return (
              <button
                key={l.id}
                type="button"
                className={`${styles.sheetRow} ${current ? styles.sheetRowCurrent : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => pick(l.id, l.name)}
              >
                <span className={styles.sheetGlyph}><LayoutIcon /></span>
                <span className={styles.sheetName}>{l.name}</span>
                {current && isDirty && <span className={styles.sheetNote}>Edited</span>}
                {current && <span className={styles.sheetCheck}><CheckIcon /></span>}
              </button>
            )
          })}
        </div>
        <p className={styles.sheetFooter}>{WIDER_SCREEN_HINT}</p>
      </div>
      {pending && (
        <UnsavedPrompt
          lead={`You’re switching to layout “${pending.name}”.`}
          layoutLead={`You’re switching to “${pending.name}”.`}
          layout={isDirty}
          listIds={unsavedLists}
          onDone={() => {
            const { id } = pending
            setPending(null)
            onClose()
            void useWorkspaceStore.getState().load(id)
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>,
    document.body,
  )
}

/** Mobile top bar: the layout picker (opens the sheet) and search (opens the filter sheet). */
function MobileTopBar({ name }: { name: string }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  return (
    <header className={styles.topBar}>
      <button
        type="button"
        className={styles.picker}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-label={`Layout: ${name}`}
        data-testid="layout-picker"
        onClick={() => setSheetOpen(true)}
      >
        <span className={styles.pickerGlyph}><LayoutIcon /></span>
        <span className={styles.pickerName}>{name}</span>
        <ChevronDownIcon />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Search"
        onClick={() => useUIStore.getState().openFilterSheetSearch()}
      >
        <SearchIcon />
      </button>
      {sheetOpen && <LayoutSheet onClose={() => setSheetOpen(false)} />}
    </header>
  )
}

/** Long-press on a list tab: the tab menu's list items as a bottom sheet. */
function ListTabSheet({ tabId, listDefinitionId, result, onClose }: {
  tabId: string
  listDefinitionId: number
  result: ListWidgetResult | undefined
  onClose: () => void
}) {
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])
  const rows: Array<{ label: string; run: () => void }> = [
    {
      label: 'List options…',
      run: () => {
        const tabEl = document.querySelector(`[data-ws-tab="${tabId}"]`)
        if (tabEl) useListWidgetStore.getState().openPopover({ kind: 'options', listDefinitionId, at: pointBelow(tabEl) })
      },
    },
    { label: 'Edit list…', run: () => useUIStore.getState().openListEditorDialog(listDefinitionId) },
    ...(result ? [{
      label: 'Copy tasks',
      run: () => {
        const labelled = !(result.sections.length === 1 && result.sections[0]?.key === 'all')
        void copyTasksRich(
          result.sections.map((sec) => ({ label: labelled ? sec.label : undefined, todos: [...sec.todos] })),
          { assignedPeopleMap, statusMap: new Map(statuses.map((st) => [st.id!, st])) },
        )
      },
    }] : []),
  ]
  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="menu"
        aria-label="List"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetRows}>
          {rows.map((row) => (
            <button
              key={row.label}
              type="button"
              role="menuitem"
              className={styles.sheetRow}
              onClick={() => { onClose(); row.run() }}
            >
              <span className={styles.sheetName}>{row.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}

/**
 * A cell on mobile: tabs switch, the ⋯ menu only collapses, a list tab's
 * long-press opens its list sheet. No layout editing.
 */
function MobileCell({ cell, fill }: { cell: LayoutCell; fill: boolean }) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setCellCollapsed = useWorkspaceStore((s) => s.setCellCollapsed)
  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  const collapsed = cell.collapsed === true
  const [lens, setLens] = useState<{ tabId: string; result: ListWidgetResult } | null>(null)
  const [tabSheet, setTabSheet] = useState<{ tabId: string; listDefinitionId: number } | null>(null)
  const activeListId = active?.kind === 'lens' ? active.config.listDefinitionId : undefined
  const activeListUnsaved = useIsListDirty(activeListId)
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement | null>(null)

  if (cell.tabs.length === 0) {
    return (
      <section className={styles.emptyCell} data-ws-cell={cell.id} data-empty="true" aria-label="Empty cell">
        <span className={styles.emptyTitle}>Empty cell</span>
        <span className={styles.emptyHint}>{WIDER_SCREEN_HINT}</span>
      </section>
    )
  }

  const menuEntries: MenuEntry[] = [
    { kind: 'item', label: 'Collapse cell', icon: <ChevronUpIcon />, onSelect: () => { void setCellCollapsed(cell.id, true) } },
  ]

  return (
    <section
      className={[styles.cell, fill && !collapsed ? styles.cellFill : '', collapsed ? styles.cellCollapsed : ''].join(' ')}
      data-ws-cell={cell.id}
      aria-label={`${activeTitle} cell`}
    >
      <div className={styles.cellHeader} data-ws-cell-header={cell.id}>
        <CellTabStrip
          cell={cell}
          collapsed={collapsed}
          touch
          activeCount={lens && lens.tabId === active?.id ? lens.result.countLabel : undefined}
          onOpenTabMenu={(tabId) => {
            const tab = cell.tabs.find((t) => t.id === tabId)
            if (tab?.kind === 'lens' && tab.config.listDefinitionId != null) setTabSheet({ tabId, listDefinitionId: tab.config.listDefinitionId })
          }}
          onActivate={(tabId) => {
            void setActiveTab(tabId)
            if (collapsed) void setCellCollapsed(cell.id, false)
          }}
        />
        {activeListUnsaved && activeListId != null && (
          <SaveListButton listDefinitionId={activeListId} className={`${styles.cellAction} ${styles.saveList}`} />
        )}
        {collapsed ? (
          <button
            type="button"
            className={styles.cellAction}
            aria-label="Expand cell"
            aria-expanded={false}
            onClick={() => { void setCellCollapsed(cell.id, false) }}
          >
            <ChevronDownIcon size={16} />
          </button>
        ) : (
          <button
            ref={moreRef}
            type="button"
            className={`${styles.cellAction} ${menuOpen ? styles.cellActionPressed : ''}`}
            aria-label="Cell options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreIcon size={16} />
          </button>
        )}
      </div>
      {!collapsed && active && (
        <div
          className={styles.cellBody}
          role="tabpanel"
          aria-labelledby={`ws-tab-${active.id}`}
          data-ws-cell-body={cell.id}
          data-kind={active.kind}
        >
          <WidgetBody
            key={active.id}
            tab={active}
            onLensResult={(result) => setLens({ tabId: active.id, result })}
          />
        </div>
      )}
      {tabSheet && (
        <ListTabSheet
          tabId={tabSheet.tabId}
          listDefinitionId={tabSheet.listDefinitionId}
          result={lens?.tabId === tabSheet.tabId ? lens.result : undefined}
          onClose={() => setTabSheet(null)}
        />
      )}
      {menuOpen && (
        <MenuPopover
          anchorRef={moreRef}
          placement="bottom-end"
          label="Cell options"
          entries={menuEntries}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </section>
  )
}

function MobileColumn({ column, index }: { column: LayoutColumn; index: number }) {
  const name = useColumnName(column, index)
  const fill = column.cells.length === 1
  return (
    <section
      className={styles.column}
      id={`ws-column-${column.id}`}
      role="tabpanel"
      aria-label={name}
      data-ws-column={column.id}
    >
      {column.cells.map((cell) => <MobileCell key={cell.id} cell={cell} fill={fill} />)}
    </section>
  )
}

function ColumnName({ column, index, active, setRef, onPick }: {
  column: LayoutColumn
  index: number
  active: boolean
  setRef: (el: HTMLButtonElement | null) => void
  onPick: () => void
}) {
  const name = useColumnName(column, index)
  return (
    <button
      ref={setRef}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`ws-column-${column.id}`}
      tabIndex={active ? 0 : -1}
      className={`${styles.stripItem} ${active ? styles.stripItemActive : ''}`}
      data-ws-column-name={column.id}
      onClick={onPick}
    >
      {name}
    </button>
  )
}

/**
 * Columns side by side, one viewport wide each, swiped with native scrolling
 * and mandatory scroll snap. The strip above names the columns; its underline
 * follows the scroll position, and tapping a name scrolls to that column.
 */
function ColumnPager({ columns }: { columns: readonly LayoutColumn[] }) {
  const pagerRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const underlineRef = useRef<HTMLSpanElement | null>(null)
  const itemEls = useRef<(HTMLButtonElement | null)[]>([])
  const frame = useRef<number | null>(null)
  const activeRef = useRef(0)
  const [active, setActive] = useState(0)
  const count = columns.length

  const sync = useCallback(() => {
    frame.current = null
    const pager = pagerRef.current
    const underline = underlineRef.current
    if (!pager) return
    const pos = pagerPosition(pager.scrollLeft, pager.clientWidth, PAGER_GAP_PX, count)
    if (underline) {
      const boxes = itemEls.current.slice(0, count).map((el) => ({
        left: (el?.offsetLeft ?? 0) + STRIP_ITEM_PADDING_PX,
        width: Math.max((el?.offsetWidth ?? 0) - STRIP_ITEM_PADDING_PX * 2, 0),
      }))
      const box = indicatorBox(boxes, pos)
      if (box) {
        underline.style.transform = `translateX(${box.left}px)`
        underline.style.width = `${box.width}px`
      }
    }
    const idx = Math.round(pos)
    activeRef.current = idx
    setActive((prev) => (prev === idx ? prev : idx))
  }, [count])

  const onScroll = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(sync)
  }, [sync])

  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current) }, [])

  // Place the underline before paint, and again when the pager or names resize
  // (rotation, renamed tabs). A resize keeps the current column in view.
  useLayoutEffect(() => {
    sync()
    const pager = pagerRef.current
    const strip = stripRef.current
    if (!pager || typeof ResizeObserver === 'undefined') return
    let width = pager.clientWidth
    const ro = new ResizeObserver(() => {
      if (pager.clientWidth !== width) {
        width = pager.clientWidth
        pager.scrollLeft = pageOffset(activeRef.current, width, PAGER_GAP_PX)
      }
      sync()
    })
    ro.observe(pager)
    if (strip) ro.observe(strip)
    for (const el of itemEls.current) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [sync])

  // Keep the active name visible when the strip overflows.
  useEffect(() => {
    const strip = stripRef.current
    const el = itemEls.current[active]
    if (!strip || !el) return
    const left = el.offsetLeft
    const right = left + el.offsetWidth
    if (left < strip.scrollLeft) strip.scrollTo({ left })
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: right - strip.clientWidth })
  }, [active])

  const goTo = useCallback((index: number, focus = false) => {
    const pager = pagerRef.current
    if (!pager) return
    const i = Math.min(Math.max(index, 0), count - 1)
    pager.scrollTo({ left: pageOffset(i, pager.clientWidth, PAGER_GAP_PX), behavior: 'smooth' })
    if (focus) itemEls.current[i]?.focus()
  }, [count])

  const onStripKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (e.key === 'ArrowRight') next = active + 1
    else if (e.key === 'ArrowLeft') next = active - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    if (next == null) return
    e.preventDefault()
    goTo(next, true)
  }

  return (
    <>
      <div ref={stripRef} className={styles.strip} role="tablist" aria-label="Columns" onKeyDown={onStripKeyDown}>
        {columns.map((column, i) => (
          <ColumnName
            key={column.id}
            column={column}
            index={i}
            active={i === active}
            setRef={(el) => { itemEls.current[i] = el }}
            onPick={() => goTo(i)}
          />
        ))}
        <span ref={underlineRef} className={styles.underline} aria-hidden="true" data-testid="ws-column-underline" />
      </div>
      <div
        ref={pagerRef}
        className={styles.pager}
        style={{ '--ws-pager-gap': `${PAGER_GAP_PX}px` } as CSSProperties}
        onScroll={onScroll}
        data-ws-area
        data-ws-pager
        data-active-column={active}
      >
        {columns.map((column, i) => <MobileColumn key={column.id} column={column} index={i} />)}
      </div>
    </>
  )
}

/**
 * The open layout on a phone: one column at a time, swiped sideways, with a
 * column strip under the top bar. Tabs switch and cells collapse (view state,
 * saved automatically); changing the layout itself is desktop-only, so this
 * view never makes unsaved changes.
 */
export function MobileWorkspaceView({ layout }: { layout: WorkspaceLayout }) {
  return (
    <div className={styles.root} data-ws-mobile>
      <MobileTopBar name={layout.name} />
      {layout.columns.length === 0 ? (
        <div className={styles.emptyLayout} data-ws-area>
          <p className={styles.emptyLayoutTitle}>This layout is empty</p>
          <p className={styles.emptyHint}>{WIDER_SCREEN_HINT}</p>
          <p className={styles.emptyHint}>Or choose a saved layout from the picker above.</p>
        </div>
      ) : (
        // Remount per layout so a switch starts at the first column.
        <ColumnPager key={layout.id ?? 'layout'} columns={layout.columns} />
      )}
    </div>
  )
}
