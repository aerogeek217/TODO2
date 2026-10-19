import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  getActiveTab,
  tabListId,
  WIDGET_KIND_SPECS,
  type BandEdge,
  type LayoutCell,
  type LayoutPanel,
  type LayoutTab,
  type WidgetKind,
} from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { getUnsavedListIds } from '../../stores/list-draft-store'
import { useSettingsStore } from '../../stores/settings-store'
import { copyTasksRich } from '../../services/task-copy'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../overlays/ListDefinitionPickerPopup'
import { CellTabStrip } from './CellTabStrip'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { AddWidgetButtons, AddWidgetFlow } from './AddWidgetFlow'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import { layoutTabs } from '../../utils/workspace-layout-ops'
import { createListThenEdit, openEditList, useListOwnerLayoutId, useTabTitle, useTabTitles } from './widget-hooks'
import { ownerLayoutId } from '../../models/list-definition'
import { UnsavedPrompt } from './UnsavedPrompt'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import {
  BandIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseCellIcon,
  CloseIcon,
  GripIcon,
  MoreIcon,
  PlusIcon,
  SplitBelowIcon,
  SplitRightIcon,
} from '../shared/icons'
import {
  tabsCount,
  useWorkspaceDrag,
  WORKSPACE_PANEL_DRAG,
  workspacePanelDragId,
  type WorkspacePanelDragData,
} from './workspace-drag'
import { useUrgentRangeSetting } from './eisenhower/urgent-range-setting'
import { CustomizeDashboardDialog } from './dashboard/CustomizeDashboardDialog'
import { CUSTOMIZE_PANES_LABEL, openEisenhowerSettings } from './eisenhower/eisenhower-settings-link'
import { useDashboardMenuActions } from './dashboard/dashboard-menu'
import { DashGlyph } from '../shared/DashGlyph'
import styles from './WorkspaceCell.module.css'

function anchorBelow(ref: RefObject<HTMLElement | null>): { x: number; y: number } {
  const r = ref.current?.getBoundingClientRect()
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 }
}

interface WorkspaceCellProps {
  /** A cell of a column, or (with `band`) a band. */
  cell: LayoutPanel
  /** Set when `cell` is the band at that edge. */
  band?: BandEdge
  style?: CSSProperties
}

/** An empty cell (right after a split): kind buttons, "or drag a tab here", and a close ×. */
function EmptyCell({ cell, style }: { cell: LayoutCell; style?: CSSProperties }) {
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const drag = useWorkspaceDrag()
  const over = drag?.hit?.kind === 'empty-cell' && drag.hit.cellId === cell.id && drag.accepts
  return (
    <section
      className={`${styles.emptyCell} ${over ? styles.emptyCellOver : ''}`}
      style={style}
      data-ws-cell={cell.id}
      data-empty="true"
      aria-label="Empty cell"
    >
      <button type="button" className={styles.emptyClose} aria-label="Close empty cell" title="Close cell" onClick={() => closeCell(cell.id)}>
        <CloseIcon size={12} />
      </button>
      <span className={styles.emptyPlus}><PlusIcon size={16} /></span>
      <span className={styles.emptyTitle}>Add a widget</span>
      <div className={styles.kindRow}>
        <AddWidgetButtons target={{ kind: 'cell', cellId: cell.id }} buttonClassName={styles.kindButton} iconClassName={styles.kindButtonIcon} />
      </div>
      <span className={styles.emptyHint}>or drag a tab here</span>
    </section>
  )
}

/**
 * The column area of a layout whose panels are all in bands: the empty cell
 * block, whose widgets (or a dropped tab / panel) start the first column.
 */
export function EmptyColumnArea() {
  const drag = useWorkspaceDrag()
  const over = drag?.hit?.kind === 'empty-columns' && drag.accepts
  return (
    <section
      className={`${styles.emptyCell} ${styles.emptyColumns} ${over ? styles.emptyCellOver : ''}`}
      data-ws-columns-empty
      aria-label="No columns"
    >
      <span className={styles.emptyPlus}><PlusIcon size={16} /></span>
      <span className={styles.emptyTitle}>Add a widget</span>
      <div className={styles.kindRow}>
        <AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={styles.kindButton} iconClassName={styles.kindButtonIcon} />
      </div>
      <span className={styles.emptyHint}>or drag a tab here</span>
    </section>
  )
}

/** What the middle of a body adds while a tab or a panel is dragged over it. */
function joinLabel(panelDrag: boolean, count: number) {
  return panelDrag ? <>Merge {tabsCount(count)} here</> : <><PlusIcon size={12} strokeWidth={2} /> Add as tab</>
}

/** Scrim + three drop zones shown over a cell body while a tab or panel is dragged over it. */
function DropZones({ zone, accepts, join }: { zone: 'top' | 'middle' | 'bottom'; accepts: boolean; join: ReactNode }) {
  const cls = (z: typeof zone) => `${styles.zone} ${accepts && zone === z ? styles.zoneActive : ''}`
  return (
    <div className={styles.zones} aria-hidden="true" data-testid="ws-drop-zones" data-active-zone={accepts ? zone : ''}>
      <div className={cls('top')}>New cell above</div>
      <div className={cls('middle')}>{join}</div>
      <div className={cls('bottom')}>New cell below</div>
    </div>
  )
}

/** Scrim + the one drop zone over a band body (a band never splits). */
function BandDropZone({ accepts, join }: { accepts: boolean; join: ReactNode }) {
  return (
    <div className={`${styles.zones} ${styles.bandZones}`} aria-hidden="true" data-testid="ws-band-drop-zone" data-active={accepts ? 'true' : ''}>
      <div className={`${styles.zone} ${accepts ? styles.zoneActive : ''}`}>{join}</div>
    </div>
  )
}

/**
 * The header's empty space: drags the whole panel (5px to start, as a tab),
 * with a faint grip on header hover. Not focusable — the ⋯ menu's Move and
 * Split items are the keyboard way.
 */
function PanelHandle({ panelId, tabs }: { panelId: string; tabs: readonly LayoutTab[] }) {
  const titles = useTabTitles(tabs)
  const data: WorkspacePanelDragData = {
    type: WORKSPACE_PANEL_DRAG,
    panelId,
    tabs: tabs.map((t, i) => ({ id: t.id, kind: t.kind, title: titles[i] ?? '' })),
  }
  const { setNodeRef, listeners } = useDraggable({ id: workspacePanelDragId(panelId), data })
  return (
    <div ref={setNodeRef} {...listeners} className={styles.fill} data-ws-panel-handle={panelId} aria-hidden="true">
      <span className={styles.grip}><GripIcon /></span>
    </div>
  )
}

/** "Change widget → List": pick (or create) the list first, so a list tab always has one. */
function ChangeToListPicker({ tabId, anchor, onClose }: { tabId: string; anchor: { x: number; y: number }; onClose: () => void }) {
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  const layoutId = useListOwnerLayoutId()
  return (
    <ListDefinitionPickerPopup
      x={anchor.x}
      y={anchor.y}
      header="Show list"
      layoutId={layoutId}
      onSelect={(id) => changeTabKind(tabId, 'lens', { listDefinitionId: id })}
      onCreateNew={(layoutOnly) => createListThenEdit((id) => {
        changeTabKind(tabId, 'lens', { listDefinitionId: id })
        return tabId
      }, layoutOnly ? layoutId : undefined)}
      onClose={onClose}
    />
  )
}

/**
 * Lists with unsaved edits whose last widget (in any layout) is among
 * `tabIds` of the open layout — closing or re-pointing those tabs would leave
 * the edits nowhere to be saved from.
 */
function listsLosingLastWidget(tabIds: readonly string[]): number[] {
  const state = useWorkspaceStore.getState()
  const unsaved = new Set(getUnsavedListIds())
  if (!state.working || unsaved.size === 0) return []
  const except = new Set(tabIds)
  const out = new Set<number>()
  const eisenhowerListId = useSettingsStore.getState().eisenhowerListId
  for (const tab of layoutTabs(state.working)) {
    if (!except.has(tab.id)) continue
    const id = tabListId(tab, eisenhowerListId)
    if (id != null && unsaved.has(id) && countListWidgets(state, id, except) === 0) out.add(id)
  }
  return [...out]
}

/** A cell (an empty one after a split, else its tabs) or a band. */
export function WorkspaceCell({ cell, band, style }: WorkspaceCellProps) {
  if (!band && cell.tabs.length === 0 && 'weight' in cell) return <EmptyCell cell={cell} style={style} />
  return <FilledCell cell={cell} band={band} style={style} />
}

function FilledCell({ cell, band, style }: WorkspaceCellProps) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const splitCell = useWorkspaceStore((s) => s.splitCell)
  const setCellCollapsed = useWorkspaceStore((s) => s.setCellCollapsed)
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  const patchTabConfig = useWorkspaceStore((s) => s.patchTabConfig)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const movePanel = useWorkspaceStore((s) => s.movePanel)
  const hasTop = useWorkspaceStore((s) => s.working?.top != null)
  const hasBottom = useWorkspaceStore((s) => s.working?.bottom != null)
  const drag = useWorkspaceDrag()
  const urgentRangeSetting = useUrgentRangeSetting()
  const noun = band ? 'band' : 'cell'

  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  const collapsed = cell.collapsed === true
  /** What the active tab's widget last reported (any kind): its count label, shown sections or summary. */
  const [widgetResult, setWidgetResult] = useState<{ tabId: string; result: WidgetResult } | null>(null)
  const [guard, setGuard] = useState<{ listIds: number[]; lead: string; run: () => void } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [cellMenuOpen, setCellMenuOpen] = useState(false)
  const [addFlow, setAddFlow] = useState<{ anchor: { x: number; y: number } } | null>(null)
  const [changeToList, setChangeToList] = useState<{ tabId: string; anchor: { x: number; y: number } } | null>(null)
  const [customize, setCustomize] = useState<{ tabId: string; focusListTiles: boolean } | null>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)

  const activeCount = widgetResult && widgetResult.tabId === active?.id ? widgetResult.result.countLabel : undefined

  /** Runs `run`, first asking about unsaved lists that would lose their last widget with `tabIds`. */
  const guarded = (tabIds: readonly string[], lead: string, run: () => void) => {
    const listIds = listsLosingLastWidget(tabIds)
    if (listIds.length === 0) run()
    else setGuard({ listIds, lead, run })
  }
  const closeTabGuarded = (tabId: string) => guarded([tabId], 'You’re closing the last widget that shows it.', () => closeTab(tabId))
  const closeCellGuarded = () => guarded(cell.tabs.map((t) => t.id), 'You’re closing the last widget that shows them.', () => closeCell(cell.id))
  const closeCustomize = useCallback(() => setCustomize(null), [])
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id!, s])), [statuses])

  const hit = drag?.hit
  const bodyHit = !band && hit?.kind === 'cell-body' && hit.cellId === cell.id ? hit : null
  const bandHit = band && hit?.kind === 'band-body' && hit.edge === band ? hit : null
  const stripHit = hit?.kind === 'tab-strip' && hit.cellId === cell.id && drag?.accepts ? hit : null
  const joining = drag?.accepts === true && (bodyHit?.zone === 'middle' || bandHit != null)
  const ghosts = joining && drag ? drag.tabs : null
  const panelDrag = drag?.source.type === 'panel'
  const join = joinLabel(panelDrag, drag?.tabs.length ?? 0)
  const isDragSource = drag?.source.type === 'panel' && drag.source.panelId === cell.id

  /** "Move to top band" (none yet) or "Move into top band" (merges into it). */
  const bandMoveEntry = (edge: BandEdge): MenuEntry => {
    const exists = edge === 'top' ? hasTop : hasBottom
    const where = edge === 'top' ? 'top' : 'bottom'
    return {
      kind: 'item',
      label: exists ? `Move into ${where} band` : `Move to ${where} band`,
      icon: <BandIcon edge={edge} />,
      onSelect: () => movePanel(cell.id, exists ? { kind: 'band', edge } : { kind: 'new-band', edge }),
    }
  }

  const menuTab = tabMenu ? cell.tabs.find((t) => t.id === tabMenu.tabId) : undefined
  const layoutId = useListOwnerLayoutId()
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  const menuListId = menuTab ? tabListId(menuTab, eisenhowerListId) : undefined
  const menuListName = useListDefinitionStore((s) =>
    menuListId != null ? s.listDefinitions.find((d) => d.id === menuListId)?.name : undefined,
  )
  /** A list tab's list when only this layout shows it: the tab menu offers Save to my lists. */
  const menuListLayoutOnly = useListDefinitionStore((s) => {
    if (menuTab?.kind !== 'lens' || menuListId == null) return false
    const def = s.listDefinitions.find((d) => d.id === menuListId)
    return def != null && ownerLayoutId(def) != null
  })

  /**
   * Changes a tab's kind. A list tab picks its list first — an Eisenhower
   * tab switched to List too: the Eisenhower's own list is never a list
   * tab's.
   */
  const changeKind = (tab: LayoutTab, kind: WidgetKind, anchor: { x: number; y: number }) => {
    if (kind === tab.kind) return
    if (WIDGET_KIND_SPECS[kind].showsList) {
      setChangeToList({ tabId: tab.id, anchor })
      return
    }
    guarded([tab.id], 'You’re changing the last widget that shows it.', () => changeTabKind(tab.id, kind))
  }

  const dashboardActions = useDashboardMenuActions({
    onCustomize: () => { if (menuTab) setCustomize({ tabId: menuTab.id, focusListTiles: false }) },
    summary: menuTab && widgetResult?.tabId === menuTab.id ? widgetResult.result.summary : undefined,
  })

  const cellMenuEntries: MenuEntry[] = [
    // The active widget's own setup, when it has one.
    ...(active?.kind === 'dashboard' ? [
      {
        kind: 'item' as const,
        label: 'Customize dashboard…',
        icon: <DashGlyph name="sliders" />,
        onSelect: () => setCustomize({ tabId: active.id, focusListTiles: false }),
      },
      { kind: 'separator' as const },
    ] : []),
    ...(active?.kind === 'eisenhower' ? [
      {
        kind: 'item' as const,
        label: CUSTOMIZE_PANES_LABEL,
        icon: <DashGlyph name="sliders" />,
        onSelect: () => openEisenhowerSettings(),
      },
      { kind: 'separator' as const },
    ] : []),
    {
      kind: 'item',
      label: 'Add widget',
      icon: <PlusIcon />,
      submenu: true,
      onSelect: () => setAddFlow({ anchor: anchorBelow(moreRef) }),
    },
    ...(band ? [
      bandMoveEntry(band === 'top' ? 'bottom' : 'top'),
      { kind: 'item' as const, label: 'Move to a new column', icon: <SplitRightIcon />, onSelect: () => movePanel(cell.id, { kind: 'layout' }) },
    ] : [
      { kind: 'item' as const, label: 'Split right', icon: <SplitRightIcon />, onSelect: () => { splitCell(cell.id, 'right') } },
      { kind: 'item' as const, label: 'Split below', icon: <SplitBelowIcon />, onSelect: () => { splitCell(cell.id, 'below') } },
      bandMoveEntry('top'),
      bandMoveEntry('bottom'),
    ]),
    {
      kind: 'item',
      label: collapsed ? `Expand ${noun}` : `Collapse ${noun}`,
      icon: collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon />,
      onSelect: () => { void setCellCollapsed(cell.id, !collapsed) },
    },
    { kind: 'separator' },
    ...(active ? [{ kind: 'item' as const, label: `Close tab “${activeTitle}”`, icon: <CloseIcon size={14} strokeWidth={1.6} />, onSelect: () => closeTabGuarded(active.id) }] : []),
    {
      kind: 'item',
      label: `Close ${noun} (${tabsCount(cell.tabs.length)})`,
      icon: <CloseCellIcon />,
      onSelect: closeCellGuarded,
    },
  ]

  return (
    <section
      className={`${styles.cell} ${collapsed ? styles.collapsed : ''} ${isDragSource ? styles.dragSource : ''}`}
      style={style}
      data-ws-cell={cell.id}
      data-ws-band={band}
      aria-label={`${activeTitle} ${noun}`}
    >
      <div
        className={`${styles.header} ${cellMenuOpen ? styles.headerMenuOpen : ''}`}
        data-ws-cell-header={cell.id}
      >
        <CellTabStrip
          cell={cell}
          collapsed={collapsed}
          activeCount={activeCount}
          ghosts={ghosts}
          onActivate={(tabId) => {
            void setActiveTab(tabId)
            if (collapsed) void setCellCollapsed(cell.id, false)
          }}
          onClose={closeTabGuarded}
          onOpenTabMenu={(tabId, p) => setTabMenu({ tabId, ...p })}
          onAddTab={(ref) => setAddFlow({ anchor: anchorBelow(ref) })}
        />
        {stripHit && drag?.insertLeft != null && (
          <span className={styles.insertLine} style={{ left: drag.insertLeft }} aria-hidden="true" data-testid="ws-tab-insert-line" />
        )}
        <PanelHandle panelId={cell.id} tabs={cell.tabs} />
        {collapsed ? (
          <button
            type="button"
            className={styles.expand}
            aria-label={`Expand ${noun}`}
            aria-expanded={false}
            title={`Expand ${noun}`}
            onClick={() => { void setCellCollapsed(cell.id, false) }}
          >
            <ChevronDownIcon size={14} />
          </button>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              aria-label={`Collapse ${noun}`}
              aria-expanded={true}
              title="Collapse"
              onClick={() => { void setCellCollapsed(cell.id, true) }}
            >
              <ChevronUpIcon />
            </button>
            <button
              ref={moreRef}
              type="button"
              className={`${styles.action} ${cellMenuOpen ? styles.actionPressed : ''}`}
              aria-label={band ? 'Band options' : 'Cell options'}
              aria-haspopup="menu"
              aria-expanded={cellMenuOpen}
              title={band ? 'Band options' : 'Cell options'}
              onClick={() => setCellMenuOpen((o) => !o)}
            >
              <MoreIcon />
            </button>
          </div>
        )}
      </div>
      {!collapsed && active && (
        <div
          className={styles.body}
          role="tabpanel"
          aria-labelledby={`ws-tab-${active.id}`}
          data-ws-cell-body={cell.id}
        >
          <WidgetBody
            key={active.id}
            tab={active}
            onResult={(result) => setWidgetResult({ tabId: active.id, result })}
            onAddListTile={active.kind === 'dashboard' ? () => setCustomize({ tabId: active.id, focusListTiles: true }) : undefined}
            onCustomize={active.kind === 'dashboard' ? () => setCustomize({ tabId: active.id, focusListTiles: false }) : undefined}
          />
          {bodyHit && <DropZones zone={bodyHit.zone} accepts={drag?.accepts === true} join={join} />}
          {bandHit && <BandDropZone accepts={drag?.accepts === true} join={join} />}
        </div>
      )}

      {cellMenuOpen && (
        <MenuPopover
          anchorRef={moreRef}
          placement="bottom-end"
          width={232}
          label={band ? 'Band options' : 'Cell options'}
          entries={cellMenuEntries}
          onClose={() => setCellMenuOpen(false)}
        />
      )}
      {addFlow && (
        <AddWidgetFlow
          target={{ kind: 'cell', cellId: cell.id }}
          anchor={addFlow.anchor}
          onClose={() => setAddFlow(null)}
        />
      )}
      {tabMenu && menuTab && (
        <WidgetKindMenu
          anchor={{ x: tabMenu.x, y: tabMenu.y }}
          currentKind={menuTab.kind}
          onChangeKind={(kind) => changeKind(menuTab, kind, { x: tabMenu.x, y: tabMenu.y })}
          pickListForLens={menuTab.kind === 'lens'
            ? (id) => {
                if (id === menuTab.config.listDefinitionId) return
                guarded([menuTab.id], 'You’re changing the last widget that shows it.', () => patchTabConfig(menuTab.id, 'lens', { listDefinitionId: id }))
              }
            : undefined}
          onEditList={menuListId != null && (menuTab.kind === 'lens' || menuListName != null)
            ? () => openEditList(menuTab.id, menuListId)
            : undefined}
          currentListName={menuListName}
          listLayoutId={layoutId}
          onSaveToMyLists={menuListLayoutOnly && menuListId != null
            ? () => { void useListDefinitionStore.getState().saveToMyLists(menuListId) }
            : undefined}
          sourceActions={menuTab.kind === 'eisenhower'
            ? [{ label: CUSTOMIZE_PANES_LABEL, onSelect: () => openEisenhowerSettings() }]
            : undefined}
          widgetSetting={menuTab.kind === 'eisenhower' ? urgentRangeSetting : undefined}
          widgetActions={menuTab.kind === 'dashboard' ? dashboardActions : menuTab.kind === 'lens' && widgetResult && widgetResult.tabId === menuTab.id
            ? [{
                label: 'Copy tasks',
                icon: '⧉',
                onSelect: () => {
                  const sections = widgetResult.result.sections
                  const labelled = !(sections.length === 1 && sections[0]?.key === 'all')
                  void copyTasksRich(
                    sections.map((sec) => ({ label: labelled ? sec.label : undefined, todos: [...sec.todos] })),
                    { assignedPeopleMap, statusMap },
                  )
                },
              }]
            : undefined}
          onClose={() => setTabMenu(null)}
        />
      )}
      {guard && (
        <UnsavedPrompt
          lead={guard.lead}
          layout={false}
          listIds={guard.listIds}
          onDone={() => { guard.run(); setGuard(null) }}
          onCancel={() => setGuard(null)}
        />
      )}
      {customize && (
        <CustomizeDashboardDialog
          tabId={customize.tabId}
          focusListTiles={customize.focusListTiles}
          onClose={closeCustomize}
        />
      )}
      {changeToList && (
        <ChangeToListPicker
          tabId={changeToList.tabId}
          anchor={changeToList.anchor}
          onClose={() => setChangeToList(null)}
        />
      )}
    </section>
  )
}
