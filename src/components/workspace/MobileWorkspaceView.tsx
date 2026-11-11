import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import {
  getActiveTab,
  isGlanceKind,
  type EisenhowerTab,
  type LayoutCell,
  type WorkspaceLayout,
} from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUIStore } from '../../stores/ui-store'
import { hueAttr, hueColor } from '../../utils/layout-hue'
import { isFitCell } from '../../utils/workspace-rows'
import { CellTabStrip } from './CellTabStrip'
import { WidgetBody } from './WidgetBody'
import { smallFaceClick, useCellFace } from './cell-face'
import { SmallFaceOpener, WidgetFacePopover } from './CellFaceParts'
import { WidgetFaceContext } from '../../hooks/use-widget-face'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { DialogFrame } from '../shared/Dialog'
import type { ListWidgetResult } from './list/ListWidget'
import { copyTasks } from '../../services/task-copy'
import { openEditList, useTabTitle } from './widget-hooks'
import { useSettingsStore } from '../../stores/settings-store'
import { useUrgentRangeSetting } from './eisenhower/urgent-range-setting'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, HuedLayoutIcon, MoreIcon } from '../shared/icons'
import { useFilterStore } from '../../stores/filter-store'
import { usePickedLens } from '../../stores/screen-filter'
import { useScreenTaskCounts } from '../../hooks/use-screen-task-count'
import { screenTaskDialog } from '../../services/task-dialog'
import { shownOfTotalText } from '../shared/filters/lens-text'
import { BadgeCapsule } from '../shared/BadgeCapsule'
import { tabBadgeSummary } from '../../utils/tab-badges'
import styles from './MobileWorkspaceView.module.css'
import { withViewTransition } from '../shared/view-transition'
import { CellControlsContext, type CellControlsValue } from './cell-controls'

const WIDER_SCREEN_HINT = 'To create or edit layouts, use a wider screen.'

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
  const currentRowRef = useRef<HTMLButtonElement | null>(null)
  const firstRowRef = useRef<HTMLButtonElement | null>(null)

  const pick = (id: number) => {
    if (id === activeLayoutId) { onClose(); return }
    withViewTransition(() => useWorkspaceStore.getState().load(id))
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
                onClick={() => pick(l.id)}
              >
                <span className={styles.sheetGlyph}><HuedLayoutIcon hue={l.hue} /></span>
                <span className={styles.sheetName}>{l.name}</span>
                {current && <span className={styles.sheetCheck}><CheckIcon /></span>}
              </button>
            )
          })}
        </div>
        <p className={styles.sheetFooter}>{WIDER_SCREEN_HINT}</p>
      </DialogFrame>
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
function MobileTopBar({ name, hue, status }: { name: string; hue?: string; status?: ReactNode }) {
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
        <span className={styles.pickerGlyph}><HuedLayoutIcon hue={hue} /></span>
        <span className={styles.pickerName}>{name}</span>
        <ChevronDownIcon />
      </button>
      <div className={styles.topBarEnd}>
        {status}
        <ShownOfTotalPill />
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
 * The phone top bar's `61 of 109` (D15): what the screen filter's chips and
 * the top bar's lens keep of every open task, while a chip is on or a
 * lens is picked; a tap lists them in the task dialog (whose filter bar
 * edits the chips). Its own component, so only it renders for a task write.
 */
function ShownOfTotalPill() {
  const chipsOn = useFilterStore((s) => s.isActive)
  const lensPicked = usePickedLens() != null
  if (!chipsOn && !lensPicked) return null
  return <ShownOfTotalCount chipsOn={chipsOn} />
}

function ShownOfTotalCount({ chipsOn }: { chipsOn: boolean }) {
  const { shown, total, withCompleted, badges } = useScreenTaskCounts()
  const badgeLines = tabBadgeSummary(badges, useSettingsStore((s) => s.tabBadges))
  return (
    <button
      type="button"
      className={`${styles.shownPill} ${chipsOn ? styles.shownPillFiltered : ''}`}
      aria-label={`${[shownOfTotalText(shown, total, withCompleted), ...badgeLines].join(', ')}. Show them`}
      data-testid="shown-of-total"
      onClick={() => useUIStore.getState().showTaskDialog(screenTaskDialog())}
    >
      <b>{shown}</b> of {total}
      {badgeLines.length > 0 && <BadgeCapsule counts={badges} data-counter-badge="" />}
    </button>
  )
}

/**
 * The tab sheets' rows are a menu: ↑ / ↓ move between its items (wrapping);
 * the frame round them (`DialogFrame`) keeps Tab inside and closes on Esc.
 */
function moveInMenu(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
  if (items.length === 0) return
  e.preventDefault()
  const at = items.findIndex((el) => el === document.activeElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length
  items[next]?.focus()
}

/**
 * An Eisenhower tab's long-press sheet: Edit list… (the Eisenhower's own
 * list) and the app-wide "Due date makes a task urgent" range (the desktop
 * tab menu's submenu). The shared dialog frame, as the layout sheet: Esc, a
 * backdrop press, focus in and kept inside, focus back on the tab.
 */
function EisenhowerSheet({ tab, onClose }: { tab: EisenhowerTab; onClose: () => void }) {
  const setting = useUrgentRangeSetting()
  const listId = useSettingsStore((s) => s.eisenhowerListId)
  const listExists = useListDefinitionStore((s) => listId != null && s.listDefinitions.some((d) => d.id === listId))
  const editList = listId != null && listExists
  // The focus starts on Edit list…, else on the range picked now.
  const focusRef = useRef<HTMLButtonElement | null>(null)
  return (
    <DialogFrame
      onClose={onClose}
      layer="overlay"
      className={styles.sheet}
      backdropClassName={styles.backdrop}
      style={SHEET_PLACEMENT}
      aria-label="Eisenhower tab"
      initialFocus={focusRef}
      onKeyDown={moveInMenu}
    >
      <span className={styles.handle} aria-hidden="true" />
      <div role="menu" aria-label="Eisenhower">
        <div className={styles.sheetRows}>
          {editList && (
            <button
              ref={focusRef}
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
              ref={!editList && o.checked ? focusRef : undefined}
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
    </DialogFrame>
  )
}

/** Copies a list's shown sections (Copy tasks): each under its label, unless the list isn't grouped. */
function copySections(result: ListWidgetResult): void {
  const labelled = !(result.sections.length === 1 && result.sections[0]?.key === 'all')
  void copyTasks(result.sections.map((sec) => ({ label: labelled ? sec.label : undefined, todos: [...sec.todos] })))
}

/** The phone's top line never lends the slot back: a face without one has its row's ⋯ elsewhere. */
function claimNothing(): () => void {
  return () => {}
}

/** Long-press on a list tab: the tab menu's list items as a bottom sheet (the frame as `EisenhowerSheet`'s). */
function ListTabSheet({ tabId, listDefinitionId, result, onClose }: {
  tabId: string
  listDefinitionId: number
  result: ListWidgetResult | undefined
  onClose: () => void
}) {
  const rows: Array<{ label: string; run: () => void }> = [
    { label: 'Edit list…', run: () => openEditList(tabId, listDefinitionId) },
    ...(result ? [{
      label: 'Copy tasks',
      run: () => copySections(result),
    }] : []),
  ]
  return (
    <DialogFrame
      onClose={onClose}
      layer="overlay"
      className={styles.sheet}
      backdropClassName={styles.backdrop}
      style={SHEET_PLACEMENT}
      aria-label="List tab"
      onKeyDown={moveInMenu}
    >
      <span className={styles.handle} aria-hidden="true" />
      <div role="menu" aria-label="List" className={styles.sheetRows}>
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
    </DialogFrame>
  )
}

/**
 * A cell of the table on mobile: tabs only when there's a choice (D26
 * AA1) — one widget's top line names it and holds the ⋯ (always shown) —;
 * tabs switch; the ⋯ menu has the widget's phone items (a list's Edit list…
 * and Copy tasks, the Eisenhower's options sheet) and collapses the row
 * tracks it covers; a list tab's long-press opens its list sheet. No layout
 * editing.
 */
function MobileCell({ cell, rowTrackIds, collapsed, fill, fitRow = false }: {
  cell: LayoutCell
  /** The ids of the row tracks it covers: what collapses. */
  rowTrackIds: readonly string[]
  collapsed: boolean
  fill: boolean
  /** It is a Number among Numbers (two up): the widget shows its small face. */
  fitRow?: boolean
}) {
  const noun = 'cell'
  const rowNoun = 'row'
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setTrackCollapsed = useWorkspaceStore((s) => s.setTrackCollapsed)
  const setRowCollapsed = useCallback((next: boolean) => { void setTrackCollapsed(rowTrackIds, next) }, [setTrackCollapsed, rowTrackIds])
  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  const [lens, setLens] = useState<{ tabId: string; result: ListWidgetResult } | null>(null)
  const [tabSheet, setTabSheet] = useState<{ tabId: string; listDefinitionId: number } | null>(null)
  const [eisenhowerSheet, setEisenhowerSheet] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The ⋯ button (in the strip's header, or a top line's slot): kept as state, so the menu anchors to whichever is drawn.
  // The ⋯ buttons drawn (the strip's header's, a top line's slot, the cell's own while no top line
  // holds one — briefly two): the menu anchors to the one still in the page.
  const [moreEls] = useState(() => new Set<HTMLButtonElement>())
  const moreRef = useMemo(() => ({
    get current(): HTMLButtonElement | null {
      for (const el of moreEls) if (el.isConnected) return el
      return null
    },
  }), [moreEls])
  const setMoreButton = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return undefined
    moreEls.add(el)
    return () => { moreEls.delete(el) }
  }, [moreEls])
  const cellRef = useRef<HTMLElement | null>(null)
  /** Tabs only when there's a choice (D26 AA1). */
  const stripShown = cell.tabs.length > 1
  // Its widget's face (D25 R): a page's cell by its size; a cell sized to its
  // content (the column scrolls) by its width alone; a fit row's small; a
  // collapsed one-widget cell's top line is its large face's first line.
  const cellFace = useCellFace(active, {
    forced: fitRow ? 'small' : collapsed && !stripShown ? 'large' : undefined,
    heightFree: !fill,
  })
  const smallFace = cellFace.face === 'small' && !collapsed
  /** A glance cell with tabs (a glance widget, or any at its small face): a slim header. */
  const compact = stripShown && active != null && (isGlanceKind(active.kind) || cellFace.face === 'small')
  const activeId = active?.id
  const controls = useMemo<CellControlsValue | null>(() => (stripShown || activeId == null ? null : {
    cellId: cell.id,
    tabs: cell.tabs,
    tabId: activeId,
    title: activeTitle,
    touch: true,
    setMoreButton,
    menuOpen,
    onMore: () => setMenuOpen((o) => !o),
    collapsed,
    onExpand: () => setRowCollapsed(false),
    claim: claimNothing,
  }), [stripShown, activeId, cell.id, cell.tabs, activeTitle, menuOpen, collapsed, setRowCollapsed, setMoreButton])

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
  const listResult = lens && lens.tabId === active?.id ? lens.result : undefined

  const widgetEntries: MenuEntry[] = []
  if (active?.kind === 'lens' && active.config.listDefinitionId != null) {
    const listId = active.config.listDefinitionId
    widgetEntries.push({ kind: 'item', label: 'Edit list…', onSelect: () => openEditList(active.id, listId) })
    if (listResult) widgetEntries.push({ kind: 'item', label: 'Copy tasks', onSelect: () => copySections(listResult) })
  } else if (active?.kind === 'eisenhower') {
    widgetEntries.push({ kind: 'item', label: 'Eisenhower options…', onSelect: () => setEisenhowerSheet(active.id) })
  }
  const menuEntries: MenuEntry[] = [
    ...widgetEntries,
    ...(widgetEntries.length > 0 ? [{ kind: 'separator' } as const] : []),
    collapsed
      ? { kind: 'item', label: `Expand ${rowNoun}`, icon: <ChevronDownIcon size={14} />, onSelect: () => setRowCollapsed(false) }
      : { kind: 'item', label: `Collapse ${rowNoun}`, icon: <ChevronUpIcon />, onSelect: () => setRowCollapsed(true) },
  ]

  return (
    <section
      ref={cellRef}
      className={[styles.cell, fill && !collapsed ? styles.cellFill : '', collapsed ? styles.cellCollapsed : '', compact ? styles.cellCompact : ''].join(' ')}
      data-ws-cell={cell.id}
      data-compact={compact ? 'true' : undefined}
      data-face={!collapsed && active ? cellFace.face : undefined}
      aria-label={`${activeTitle} ${noun}`}
    >
      {stripShown && (
        <div className={styles.cellHeader} data-ws-cell-header={cell.id}>
          <CellTabStrip
            cell={cell}
            collapsed={collapsed}
            touch
            activeCount={listResult?.countLabel}
            onOpenTabMenu={(tabId) => {
              const tab = cell.tabs.find((t) => t.id === tabId)
              if (tab?.kind === 'lens' && tab.config.listDefinitionId != null) setTabSheet({ tabId, listDefinitionId: tab.config.listDefinitionId })
              if (tab?.kind === 'eisenhower') setEisenhowerSheet(tabId)
            }}
            onActivate={(tabId) => {
              withViewTransition(() => {
                void setActiveTab(tabId)
                if (collapsed) setRowCollapsed(false)
              })
            }}
          />
          {collapsed ? (
            <button
              type="button"
              className={styles.cellAction}
              aria-label={`Expand ${rowNoun}`}
              aria-expanded={false}
              onClick={() => setRowCollapsed(false)}
            >
              <ChevronDownIcon size={16} />
            </button>
          ) : (
            <button
              ref={setMoreButton}
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
      )}
      {(!collapsed || !stripShown) && active && (
        <div
          className={styles.cellBody}
          role={stripShown ? 'tabpanel' : undefined}
          aria-labelledby={stripShown ? `ws-tab-${active.id}` : undefined}
          data-ws-cell-body={cell.id}
          data-kind={active.kind}
          onClick={collapsed ? undefined : smallFaceClick(cellFace)}
        >
          {smallFace && <SmallFaceOpener title={activeTitle} open={cellFace.fullOpen} onOpen={cellFace.openFull} />}
          <CellControlsContext.Provider value={controls}>
            <WidgetFaceContext.Provider value={cellFace.host}>
              <WidgetBody
                key={active.id}
                tab={active}
                onResult={(result) => setLens({ tabId: active.id, result })}
              />
            </WidgetFaceContext.Provider>
          </CellControlsContext.Provider>
        </div>
      )}
      {cellFace.fullOpen && active && !collapsed && (
        <WidgetFacePopover tab={active} anchorRef={cellRef} onClose={cellFace.closeFull} />
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
          label="Cell options"
          entries={menuEntries}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </section>
  )
}

/**
 * Every cell of the table in reading order (by its top track, then its
 * left), in one scroll; a run of Numbers side by side, two up while two
 * fit (each at least 140px). One cell alone fills the screen.
 */
function MobileTable({ layout }: { layout: WorkspaceLayout }) {
  const rows = layout.grid.rows
  const fill = layout.cells.length === 1
  const groups: LayoutCell[][] = []
  for (const cell of layout.cells) {
    const last = groups.at(-1)
    const lastCell = last?.at(-1)
    if (last && lastCell && isFitCell(lastCell) && isFitCell(cell)) last.push(cell)
    else groups.push([cell])
  }
  const cellOf = (cell: LayoutCell, fitRow: boolean) => {
    const tracks = rows.slice(cell.area.row, cell.area.row + cell.area.rowSpan)
    return (
      <MobileCell
        key={cell.id}
        cell={cell}
        rowTrackIds={tracks.map((t) => t.id)}
        collapsed={tracks.length > 0 && tracks.every((t) => t.collapsed === true)}
        fill={fill}
        fitRow={fitRow}
      />
    )
  }
  return (
    <div
      className={styles.scroll}
      // The layout's hue (D19), as the desktop workspace: the cell headers' tint and the focus ring.
      style={{ '--layout-hue': hueColor(layout.hue) } as CSSProperties}
      data-layout-hue={hueAttr(layout.hue)}
      data-ws-area
      data-ws-scroll
    >
      <section className={styles.table} aria-label={layout.name} data-ws-table>
        {groups.map((group) => {
          const first = group[0]
          if (!first) return null
          const fit = isFitCell(first)
          return fit
            ? <div key={first.id} className={styles.fitRow} data-fit="true">{group.map((c) => cellOf(c, true))}</div>
            : cellOf(first, false)
        })}
      </section>
    </div>
  )
}

/**
 * The open layout on a phone: every cell in reading order, in one scroll
 * (D26). Tabs switch and cells collapse (view state, saved automatically);
 * changing the layout itself is desktop-only, so this view never makes
 * unsaved changes. `status` sits in the top bar beside search (the storage
 * status button).
 */
export function MobileWorkspaceView({ layout, status }: { layout: WorkspaceLayout; status?: ReactNode }) {
  return (
    <div className={styles.root} data-ws-mobile>
      <MobileTopBar name={layout.name} hue={layout.hue} status={status} />
      {layout.cells.length === 0 ? (
        <div className={styles.emptyLayout} data-ws-area>
          <p className={styles.emptyLayoutTitle}>This layout is empty</p>
          <p className={styles.emptyHint}>{WIDER_SCREEN_HINT}</p>
          <p className={styles.emptyHint}>Or choose a saved layout from the picker above.</p>
        </div>
      ) : (
        <MobileTable key={layout.id ?? 'layout'} layout={layout} />
      )}
    </div>
  )
}
