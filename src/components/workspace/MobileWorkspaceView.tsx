import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  getActiveTab,
  type BandEdge,
  type EisenhowerTab,
  type LayoutBand,
  type LayoutColumn,
  type LayoutPanel,
  type WorkspaceLayout,
} from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUIStore } from '../../stores/ui-store'
import { indicatorBox, pageOffset, pagerPosition } from '../../utils/column-pager'
import { CellTabStrip } from './CellTabStrip'
import { WidgetBody } from './WidgetBody'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { UnsavedPrompt } from './UnsavedPrompt'
import { DialogFrame } from '../shared/Dialog'
import type { ListWidgetResult } from './list/ListWidget'
import { useUnsavedListIds } from '../../hooks/use-list-draft'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { copyTasksRich } from '../../services/task-copy'
import { openEditList, useTabTitle } from './widget-hooks'
import { useSettingsStore } from '../../stores/settings-store'
import { useUrgentRangeSetting } from './eisenhower/urgent-range-setting'
import { BandIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, LayoutIcon, MoreIcon } from '../shared/icons'
import styles from './MobileWorkspaceView.module.css'

/** Gap between columns in the pager (px). */
const PAGER_GAP_PX = 8
/** The strip underline sits under the name, inside the button's side padding. */
const STRIP_ITEM_PADDING_PX = 12

const WIDER_SCREEN_HINT = 'To create or edit layouts, use a wider screen.'

/** One pager page: a column, or a band (the top band first, the bottom band last). */
type PagerPage =
  | { kind: 'column'; id: string; column: LayoutColumn }
  | { kind: 'band'; id: string; edge: BandEdge; band: LayoutBand }

function pagesOf(layout: WorkspaceLayout): PagerPage[] {
  const pages: PagerPage[] = layout.columns.map((column) => ({ kind: 'column', id: column.id, column }))
  if (layout.top) pages.unshift({ kind: 'band', id: layout.top.id, edge: 'top', band: layout.top })
  if (layout.bottom) pages.push({ kind: 'band', id: layout.bottom.id, edge: 'bottom', band: layout.bottom })
  return pages
}

/** A page's name: the active tab title of its band, or of a column's first cell. */
function usePageName(page: PagerPage, index: number): string {
  const first = page.kind === 'band' ? page.band : page.column.cells[0]
  const title = useTabTitle(first ? getActiveTab(first) : undefined)
  return title || (page.kind === 'band' ? `${page.edge === 'top' ? 'Top' : 'Bottom'} band` : `Column ${index + 1}`)
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
  const currentRowRef = useRef<HTMLButtonElement | null>(null)
  const firstRowRef = useRef<HTMLButtonElement | null>(null)

  const pick = (id: number, name: string) => {
    if (id === activeLayoutId) { onClose(); return }
    // Unsaved changes can only come from a wider screen in this session; still never lose them silently.
    if (useWorkspaceStore.getState().isDirty || unsavedLists.length > 0) { setPending({ id, name }); return }
    void useWorkspaceStore.getState().load(id)
    onClose()
  }

  return (
    <>
      {/* The shared dialog frame (Esc, a backdrop press, focus in on the open
          layout and kept inside, focus back on close), as a bottom sheet. */}
      <DialogFrame
        onClose={onClose}
        layer="overlay"
        className={styles.sheet}
        backdropClassName={styles.backdrop}
        style={SHEET_PLACEMENT}
        aria-labelledby="ws-layout-sheet-title"
        initialFocus={layouts.some((l) => l.id === activeLayoutId) ? currentRowRef : firstRowRef}
      >
        <span className={styles.handle} aria-hidden="true" />
        <h2 id="ws-layout-sheet-title" className={styles.sheetTitle}>Layouts</h2>
        <div className={styles.sheetRows}>
          {layouts.map((l) => {
            const current = l.id === activeLayoutId
            return (
              <button
                key={l.id}
                ref={current ? currentRowRef : l.id === layouts[0]?.id ? firstRowRef : undefined}
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
      </DialogFrame>
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
    </>
  )
}

/** The frame centres its panel; a bottom sheet sits on the bottom edge, full width. */
const SHEET_PLACEMENT: CSSProperties = { margin: 'auto 0 0', width: '100%' }

/**
 * Mobile top bar: the layout picker (opens the sheet), then — at the right —
 * the storage status (`status`, shown only while a warning is active) and
 * search (opens the filter sheet).
 */
function MobileTopBar({ name, status }: { name: string; status?: ReactNode }) {
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
      <div className={styles.topBarEnd}>
        {status}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Search"
          onClick={() => useUIStore.getState().openFilterSheetSearch()}
        >
          <SearchIcon />
        </button>
      </div>
      {sheetOpen && <LayoutSheet onClose={() => setSheetOpen(false)} />}
    </header>
  )
}

/**
 * An Eisenhower tab's long-press sheet: Edit list… (the Eisenhower's own
 * list) and the app-wide "Due date makes a task urgent" range (the desktop
 * tab menu's submenu).
 */
function EisenhowerSheet({ tab, onClose }: { tab: EisenhowerTab; onClose: () => void }) {
  const setting = useUrgentRangeSetting()
  const listId = useSettingsStore((s) => s.eisenhowerListId)
  const listExists = useListDefinitionStore((s) => listId != null && s.listDefinitions.some((d) => d.id === listId))
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"], [aria-checked="true"]')?.focus()
  }, [])
  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="menu"
        aria-label="Eisenhower"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetRows}>
          {listId != null && listExists && (
            <button
              type="button"
              role="menuitem"
              className={styles.sheetRow}
              onClick={() => { onClose(); openEditList(tab.id, listId) }}
            >
              <span className={styles.sheetName}>Edit list…</span>
            </button>
          )}
        </div>
        <div className={styles.sheetFootnote}>To change the panes, use Settings on a wider screen.</div>
        <div className={`${styles.sheetTitle} ${styles.sheetSectionTitle}`}>{setting.heading}</div>
        <div className={styles.sheetRows}>
          {setting.options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitemradio"
              aria-checked={o.checked}
              className={styles.sheetRow}
              onClick={() => { o.onSelect(); onClose() }}
            >
              <span className={styles.sheetName}>{o.label}</span>
              {o.note && <span className={styles.sheetNote}>{o.note}</span>}
              {o.checked && <span className={styles.sheetCheck} aria-hidden="true"><CheckIcon /></span>}
            </button>
          ))}
        </div>
        {setting.footnote && <div className={styles.sheetFootnote}>{setting.footnote}</div>}
      </div>
    </>,
    document.body,
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
    { label: 'Edit list…', run: () => openEditList(tabId, listDefinitionId) },
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
 * A cell (or a band) on mobile: tabs switch, the ⋯ menu only collapses, a
 * list tab's long-press opens its list sheet. No layout editing.
 */
function MobileCell({ cell, fill, band = false }: { cell: LayoutPanel; fill: boolean; band?: boolean }) {
  const noun = band ? 'band' : 'cell'
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setCellCollapsed = useWorkspaceStore((s) => s.setCellCollapsed)
  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  const collapsed = cell.collapsed === true
  const [lens, setLens] = useState<{ tabId: string; result: ListWidgetResult } | null>(null)
  const [tabSheet, setTabSheet] = useState<{ tabId: string; listDefinitionId: number } | null>(null)
  const [eisenhowerSheet, setEisenhowerSheet] = useState<string | null>(null)
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

  const sheetTab = eisenhowerSheet != null ? cell.tabs.find((t) => t.id === eisenhowerSheet) : undefined
  const eisenhowerTab = sheetTab?.kind === 'eisenhower' ? sheetTab : undefined

  const menuEntries: MenuEntry[] = [
    { kind: 'item', label: `Collapse ${noun}`, icon: <ChevronUpIcon />, onSelect: () => { void setCellCollapsed(cell.id, true) } },
  ]

  return (
    <section
      className={[styles.cell, fill && !collapsed ? styles.cellFill : '', collapsed ? styles.cellCollapsed : ''].join(' ')}
      data-ws-cell={cell.id}
      aria-label={`${activeTitle} ${noun}`}
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
            if (tab?.kind === 'eisenhower') setEisenhowerSheet(tabId)
          }}
          onActivate={(tabId) => {
            void setActiveTab(tabId)
            if (collapsed) void setCellCollapsed(cell.id, false)
          }}
        />
        {collapsed ? (
          <button
            type="button"
            className={styles.cellAction}
            aria-label={`Expand ${noun}`}
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
            aria-label={band ? 'Band options' : 'Cell options'}
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
            onResult={(result) => setLens({ tabId: active.id, result })}
          />
        </div>
      )}
      {eisenhowerTab && <EisenhowerSheet tab={eisenhowerTab} onClose={() => setEisenhowerSheet(null)} />}
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
          label={band ? 'Band options' : 'Cell options'}
          entries={menuEntries}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </section>
  )
}

/** A pager page: a column's cells, or a band as one full-height cell. */
function MobilePage({ page, index }: { page: PagerPage; index: number }) {
  const name = usePageName(page, index)
  if (page.kind === 'band') {
    return (
      <section
        className={styles.column}
        id={`ws-column-${page.id}`}
        role="tabpanel"
        aria-label={name}
        data-ws-band-page={page.edge}
      >
        <MobileCell cell={page.band} fill band />
      </section>
    )
  }
  const { column } = page
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

function PageName({ page, index, active, setRef, onPick }: {
  page: PagerPage
  index: number
  active: boolean
  setRef: (el: HTMLButtonElement | null) => void
  onPick: () => void
}) {
  const name = usePageName(page, index)
  return (
    <button
      ref={setRef}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`ws-column-${page.id}`}
      tabIndex={active ? 0 : -1}
      className={`${styles.stripItem} ${active ? styles.stripItemActive : ''} ${page.kind === 'band' ? styles.stripItemBand : ''}`}
      data-ws-column-name={page.id}
      data-ws-band-name={page.kind === 'band' ? page.edge : undefined}
      onClick={onPick}
    >
      {page.kind === 'band' && <span className={styles.bandGlyph}><BandIcon edge={page.edge} size={12} /></span>}
      {page.kind === 'band' ? <span className={styles.stripName}>{name}</span> : name}
    </button>
  )
}

/**
 * Pages side by side — the top band, the columns, the bottom band — one
 * viewport wide each, swiped with native scrolling and mandatory scroll
 * snap. The strip above names them (bands with a band glyph); its underline
 * follows the scroll position, and tapping a name scrolls to that page.
 */
function ColumnPager({ pages }: { pages: readonly PagerPage[] }) {
  const pagerRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const underlineRef = useRef<HTMLSpanElement | null>(null)
  const itemEls = useRef<(HTMLButtonElement | null)[]>([])
  const frame = useRef<number | null>(null)
  const activeRef = useRef(0)
  const [active, setActive] = useState(0)
  const count = pages.length

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
        {pages.map((page, i) => (
          <PageName
            key={page.id}
            page={page}
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
        {pages.map((page, i) => <MobilePage key={page.id} page={page} index={i} />)}
      </div>
    </>
  )
}

/**
 * The open layout on a phone: one column (or band) at a time, swiped
 * sideways, with a strip of their names under the top bar. Tabs switch and
 * cells collapse (view state, saved automatically); changing the layout
 * itself is desktop-only, so this view never makes unsaved changes.
 * `status` sits in the top bar beside search (the storage status button).
 */
export function MobileWorkspaceView({ layout, status }: { layout: WorkspaceLayout; status?: ReactNode }) {
  const pages = pagesOf(layout)
  return (
    <div className={styles.root} data-ws-mobile>
      <MobileTopBar name={layout.name} status={status} />
      {pages.length === 0 ? (
        <div className={styles.emptyLayout} data-ws-area>
          <p className={styles.emptyLayoutTitle}>This layout is empty</p>
          <p className={styles.emptyHint}>{WIDER_SCREEN_HINT}</p>
          <p className={styles.emptyHint}>Or choose a saved layout from the picker above.</p>
        </div>
      ) : (
        // Remount per layout so a switch starts at the first column.
        <ColumnPager key={layout.id ?? 'layout'} pages={pages} />
      )}
    </div>
  )
}
