import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  getActiveTab,
  isGlanceTab,
  tabListId,
  WIDGET_KIND_SPECS,
  type BandEdge,
  type LayoutTab,
  type WidgetKind,
} from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { getUnsavedListIds } from '../../stores/list-draft-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { copyTasks } from '../../services/task-copy'
import { WidgetKindMenu, type WidgetMenuAction } from '../shared/WidgetKindMenu'
import { CellTabStrip } from './CellTabStrip'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { AddWidgetFlow } from './AddWidgetFlow'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import { layoutTabs } from '../../utils/workspace-layout-queries'
import { createListThenEdit, NO_LIST_LAYOUT_REASON, openEditList, useListOwnerLayoutId, useTabTitle, useTabTitles } from './widget-hooks'
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
  NewColumnIcon,
  PlusIcon,
  SplitBelowIcon,
  SplitRightIcon,
  TabStripIcon,
} from '../shared/icons'
import {
  tabsCount,
  useWorkspaceDrag,
  WORKSPACE_PANEL_DRAG,
  workspacePanelDragId,
  type WorkspacePanelDragData,
} from './workspace-drag'
import { useUrgentRangeSetting } from './eisenhower/urgent-range-setting'
import { CUSTOMIZE_PANES_LABEL, openEisenhowerSettings } from './eisenhower/eisenhower-settings-link'
import { useNeglectMenuEntries } from './neglect/neglect-menu'
import { glanceMenu } from './glance/glance-menu'
import { useListZoomMenuEntries } from './list/zoom-menu'
import { GlanceGlyph } from '../shared/GlanceGlyph'
import styles from './WorkspaceCell.module.css'
import type { WorkspaceCellProps } from './WorkspaceCell'
import { trackScrollEdges } from '../../utils/scroll-edges'
import type { BandZone, CellZone } from '../../utils/workspace-drop'
import { isHeadlessCell, stripShownChoice } from '../../utils/workspace-rows'
import { WidgetFaceContext } from '../../hooks/use-widget-face'
import { CELL_HEADER_PX, smallFaceClick, useCellFace } from './cell-face'
import { SmallFaceOpener, WidgetFacePopover } from './CellFaceParts'
import { transitionName, withViewTransition } from '../shared/view-transition'

function anchorBelow(ref: RefObject<HTMLElement | null>): { x: number; y: number } {
  const r = ref.current?.getBoundingClientRect()
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 }
}

/** What the middle of a body adds while a tab or a panel is dragged over it. */
function joinLabel(panelDrag: boolean, count: number) {
  return panelDrag ? <>Merge {tabsCount(count)} here</> : <><PlusIcon size={12} strokeWidth={2} /> Add as tab</>
}

/**
 * Scrim + drop zones over a cell body while a tab or panel is dragged over
 * it: beside it left / right, a row above / below (its own row's, `multi`:
 * the row holds other cells too), and the middle that joins it. Drawn in the
 * hit test's proportions (`SIDE_ZONE_SHARE`, quarters).
 */
function DropZones({ zone, accepts, join, multi }: { zone: CellZone; accepts: boolean; join: ReactNode; multi: boolean }) {
  const cls = (z: CellZone) => `${styles.zone} ${styles[`zone_${z}`] ?? ''} ${accepts && zone === z ? styles.zoneActive : ''}`
  const noun = multi ? 'row' : 'cell'
  return (
    <div className={`${styles.zones} ${styles.cellZones}`} aria-hidden="true" data-testid="ws-drop-zones" data-active-zone={accepts ? zone : ''}>
      <div className={cls('left')}><span className={styles.zoneSideLabel}>New cell left</span></div>
      <div className={cls('top')}>New {noun} above</div>
      <div className={cls('middle')}>{join}</div>
      <div className={cls('bottom')}>New {noun} below</div>
      <div className={cls('right')}><span className={styles.zoneSideLabel}>New cell right</span></div>
    </div>
  )
}

/** Scrim + a band body's zones: beside it left / right, and the middle that joins it (a band is one row). */
function BandDropZone({ zone, accepts, join }: { zone: BandZone; accepts: boolean; join: ReactNode }) {
  const cls = (z: BandZone) => `${styles.zone} ${styles[`zone_${z}`] ?? ''} ${accepts && zone === z ? styles.zoneActive : ''}`
  return (
    <div className={`${styles.zones} ${styles.bandZones}`} aria-hidden="true" data-testid="ws-band-drop-zone" data-active={accepts ? 'true' : ''} data-active-zone={accepts ? zone : ''}>
      <div className={cls('left')}><span className={styles.zoneSideLabel}>New cell left</span></div>
      <div className={cls('middle')}>{join}</div>
      <div className={cls('right')}><span className={styles.zoneSideLabel}>New cell right</span></div>
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
    <div ref={setNodeRef} {...listeners} className={styles.fill} data-ws-panel-handle={panelId} data-strip-room="" aria-hidden="true">
      <span className={styles.grip}><GripIcon /></span>
    </div>
  )
}

/** A list tab's menu switch for the top bar's lens on its list: checked while it applies; saved at once. */
function lensSwitchAction(lens: NonNullable<WidgetResult['lens']>): WidgetMenuAction {
  return {
    label: `Apply lens “${lens.name}” here`,
    checked: !lens.ignored,
    onSelect: () => void useListDefinitionStore.getState().setIgnoreLens(lens.listId, !lens.ignored),
  }
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

/**
 * A cell holding tabs, in a column's row or a band: its header (the tab
 * strip, the panel handle, collapse and the ⋯ menu), its active widget's
 * body at its face (D25 R; headless as `utils/workspace-rows` says), the
 * drop zones while a tab or panel is dragged over it, and its menus.
 */
export function FilledCell({ cell, band, rowId, collapsed, multiRow = false, fitRow = false, style }: WorkspaceCellProps) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const splitCell = useWorkspaceStore((s) => s.splitCell)
  const setRowCollapsed = useWorkspaceStore((s) => s.setRowCollapsed)
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  const patchTabConfig = useWorkspaceStore((s) => s.patchTabConfig)
  const movePanel = useWorkspaceStore((s) => s.movePanel)
  const setCellStripShown = useWorkspaceStore((s) => s.setCellStripShown)
  const hasTop = useWorkspaceStore((s) => s.working?.top != null)
  const hasBottom = useWorkspaceStore((s) => s.working?.bottom != null)
  const drag = useWorkspaceDrag()
  const urgentRangeSetting = useUrgentRangeSetting()
  const noun = band ? 'band' : 'cell'
  /** What collapses with this cell: its band, its row (shared with other cells) or just it. */
  const rowNoun = band ? 'band' : multiRow ? 'row' : 'cell'
  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  /** Headless whatever its face (one glance tab, or its strip hidden in the menu). */
  const headlessByWidget = isHeadlessCell(cell)
  // The active widget's face (D25 R): a fit row's is small; a cell headless
  // only at its small face lends the body its header's room (measured as if headed).
  const cellFace = useCellFace(active, {
    forced: fitRow ? 'small' : undefined,
    smallAllowancePx: !headlessByWidget && cell.tabs.length === 1 && cell.stripShown !== true ? CELL_HEADER_PX : undefined,
  })
  const smallFace = cellFace.face === 'small'
  /** Headless: the strip is hidden until hover / focus (never while collapsed: the header is all it shows). */
  const headless = !collapsed && isHeadlessCell(cell, undefined, smallFace)
  const cellRef = useRef<HTMLElement | null>(null)
  /** What the active tab's widget last reported (any kind): its count label, shown sections or summary. */
  const [widgetResult, setWidgetResult] = useState<{ tabId: string; result: WidgetResult } | null>(null)
  const [guard, setGuard] = useState<{ listIds: number[]; lead: string; run: () => void } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [cellMenuOpen, setCellMenuOpen] = useState(false)
  const [addFlow, setAddFlow] = useState<{ anchor: { x: number; y: number } } | null>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  /** A menu of the cell is open: a headless cell keeps its strip in while it is. */
  const stripPinned = cellMenuOpen || tabMenu != null || addFlow != null

  const activeResult = widgetResult && widgetResult.tabId === active?.id ? widgetResult.result : undefined
  const activeCount = activeResult?.countLabel

  /** Runs `run`, first asking about unsaved lists that would lose their last widget with `tabIds`. */
  const guarded = (tabIds: readonly string[], lead: string, run: () => void) => {
    const listIds = listsLosingLastWidget(tabIds)
    if (listIds.length === 0) run()
    else setGuard({ listIds, lead, run })
  }
  const closeTabGuarded = (tabId: string) => guarded([tabId], 'You’re closing the last widget that shows it.', () => closeTab(tabId))
  const closeCellGuarded = () => guarded(cell.tabs.map((t) => t.id), 'You’re closing the last widget that shows them.', () => closeCell(cell.id))

  const hit = drag?.hit
  const bodyHit = !band && hit?.kind === 'cell-body' && hit.cellId === cell.id ? hit : null
  const bandHit = band && hit?.kind === 'band-body' && hit.cellId === cell.id ? hit : null
  const stripHit = hit?.kind === 'tab-strip' && hit.cellId === cell.id && drag?.accepts ? hit : null
  const joining = drag?.accepts === true && (bodyHit?.zone === 'middle' || bandHit?.zone === 'middle')
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

  /**
   * Changes a tab's kind. Switched to List — an Eisenhower tab too: the
   * Eisenhower's own list is never a list tab's — it shows a new blank list
   * of the layout, whose Edit list opens at once.
   */
  const changeKind = (tab: LayoutTab, kind: WidgetKind) => {
    if (kind === tab.kind) return
    if (WIDGET_KIND_SPECS[kind].showsList) {
      if (layoutId == null) return
      // An Eisenhower tab shows the Eisenhower's list: asked about first,
      // as any change of the last widget showing an unsaved list.
      guarded([tab.id], 'You’re changing the last widget that shows it.', () => createListThenEdit((id) => {
        changeTabKind(tab.id, 'lens', { listDefinitionId: id })
        return tab.id
      }, layoutId))
      return
    }
    guarded([tab.id], 'You’re changing the last widget that shows it.', () => changeTabKind(tab.id, kind))
  }

  const neglectEntries = useNeglectMenuEntries(menuTab?.kind === 'neglect' ? menuTab : undefined)
  const zoomEntries = useListZoomMenuEntries(menuTab?.kind === 'lens' ? menuTab : undefined)
  // A glance widget's settings and Copy (its lines, while it is the cell's active tab).
  const glance = glanceMenu(
    menuTab && isGlanceTab(menuTab) ? menuTab : undefined,
    menuTab && widgetResult?.tabId === menuTab.id ? widgetResult.result.summary : undefined,
  )

  const cellMenuEntries: MenuEntry[] = [
    // The active widget's own setup, when it has one.
    ...(active?.kind === 'eisenhower' ? [
      {
        kind: 'item' as const,
        label: CUSTOMIZE_PANES_LABEL,
        icon: <GlanceGlyph name="sliders" />,
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
    {
      kind: 'item',
      label: 'Split',
      icon: <SplitRightIcon />,
      children: [
        { kind: 'item', label: 'Right', icon: <SplitRightIcon />, onSelect: () => { splitCell(cell.id, 'right') } },
        // A band is one row: it splits beside only.
        ...(band ? [] : [
          { kind: 'item' as const, label: 'Below', icon: <SplitBelowIcon />, onSelect: () => { splitCell(cell.id, 'below') } },
          { kind: 'item' as const, label: 'New column', icon: <NewColumnIcon />, onSelect: () => { splitCell(cell.id, 'new-column') } },
        ]),
      ],
    },
    ...(band ? [
      bandMoveEntry(band === 'top' ? 'bottom' : 'top'),
      { kind: 'item' as const, label: 'Move to a new column', icon: <NewColumnIcon />, onSelect: () => movePanel(cell.id, { kind: 'layout' }) },
    ] : [
      bandMoveEntry('top'),
      bandMoveEntry('bottom'),
    ]),
    // One tab: its strip can hide (headless) or show; the way its widget has it is the default, written as no choice.
    ...(cell.tabs.length === 1 ? [{
      kind: 'item' as const,
      label: headless ? 'Show tab strip' : 'Hide tab strip',
      icon: <TabStripIcon />,
      onSelect: () => setCellStripShown(cell.id, stripShownChoice(cell, headless, undefined, smallFace)),
    }] : []),
    {
      kind: 'item',
      label: collapsed ? `Expand ${rowNoun}` : `Collapse ${rowNoun}`,
      icon: collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon />,
      onSelect: () => { void setRowCollapsed(rowId, !collapsed) },
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
      ref={cellRef}
      className={[
        styles.cell,
        collapsed ? styles.collapsed : '',
        isDragSource ? styles.dragSource : '',
        headless ? styles.headless : '',
        headless && drag ? styles.headlessQuiet : '',
      ].join(' ')}
      style={{ ...style, viewTransitionName: transitionName('ws-cell', cell.id) }}
      data-ws-cell={cell.id}
      data-ws-band={band}
      data-headless={headless ? 'true' : undefined}
      data-face={!collapsed && active ? cellFace.face : undefined}
      aria-label={`${activeTitle} ${noun}`}
      onContextMenu={headless ? (e) => {
        // A headless cell's right-click is its tab's menu (a widget's own menu, e.g. a row's, goes first).
        // Not one from the full widget's popover (portaled, but in this React tree).
        if (e.defaultPrevented || !active || !(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return
        e.preventDefault()
        setTabMenu({ tabId: active.id, x: e.clientX, y: e.clientY })
      } : undefined}
    >
      <div
        className={[styles.header, cellMenuOpen ? styles.headerMenuOpen : '', headless && stripPinned ? styles.stripPinned : ''].join(' ')}
        data-ws-cell-header={cell.id}
        data-strip-hidden={headless ? '' : undefined}
      >
        <CellTabStrip
          cell={cell}
          collapsed={collapsed}
          activeCount={activeCount}
          activeLens={activeCount != null ? activeResult?.lens : undefined}
          ghosts={ghosts}
          onActivate={(tabId) => {
            withViewTransition(() => {
              void setActiveTab(tabId)
              if (collapsed) void setRowCollapsed(rowId, false)
            })
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
            aria-label={`Expand ${rowNoun}`}
            aria-expanded={false}
            title={`Expand ${rowNoun}`}
            onClick={() => { void setRowCollapsed(rowId, false) }}
          >
            <ChevronDownIcon size={14} />
          </button>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              aria-label={`Collapse ${rowNoun}`}
              aria-expanded={true}
              title="Collapse"
              onClick={() => { void setRowCollapsed(rowId, true) }}
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
        // The drop zones sit beside the body, over it, so a body its widget scrolls keeps them in view (cr33 W7).
        <div className={styles.bodyFrame}>
          <div
            ref={trackScrollEdges}
            className={`${styles.body} ${smallFace ? styles.bodySmall : ''}`}
            role="tabpanel"
            aria-labelledby={`ws-tab-${active.id}`}
            data-ws-cell-body={cell.id}
            // A small face opens its full widget (a widget's own click goes first).
            onClick={drag ? undefined : smallFaceClick(cellFace)}
          >
            {smallFace && !drag && <SmallFaceOpener title={activeTitle} open={cellFace.fullOpen} onOpen={cellFace.openFull} />}
            <WidgetFaceContext.Provider value={cellFace.host}>
              <WidgetBody
                key={active.id}
                tab={active}
                onResult={(result) => setWidgetResult({ tabId: active.id, result })}
              />
            </WidgetFaceContext.Provider>
          </div>
          {bodyHit && <DropZones zone={bodyHit.zone} multi={bodyHit.multi} accepts={drag?.accepts === true} join={join} />}
          {bandHit && <BandDropZone zone={bandHit.zone} accepts={drag?.accepts === true} join={join} />}
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
          onChangeKind={(kind) => changeKind(menuTab, kind)}
          unavailableKinds={layoutId == null ? { lens: NO_LIST_LAYOUT_REASON } : undefined}
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
          sourceActions={menuTab.kind === 'eisenhower'
            ? [{ label: CUSTOMIZE_PANES_LABEL, onSelect: () => openEisenhowerSettings() }]
            : undefined}
          widgetSetting={menuTab.kind === 'eisenhower' ? urgentRangeSetting : undefined}
          settingEntries={menuTab.kind === 'neglect' ? neglectEntries : menuTab.kind === 'lens' ? zoomEntries : glance?.settingEntries}
          widgetActions={glance ? glance.actions : menuTab.kind === 'lens' && widgetResult && widgetResult.tabId === menuTab.id
            ? [
                // The top bar's lens on this list, while one applies there: on / off here (saved at once).
                ...(widgetResult.result.lens ? [lensSwitchAction(widgetResult.result.lens)] : []),
                {
                  label: 'Copy tasks',
                  icon: '⧉',
                  onSelect: () => {
                    const sections = widgetResult.result.sections
                    const labelled = !(sections.length === 1 && sections[0]?.key === 'all')
                    void copyTasks(sections.map((sec) => ({ label: labelled ? sec.label : undefined, todos: [...sec.todos] })))
                  },
                },
                // A grouped list: fold or unfold every group (the collapse set is per tab, never saved).
                ...(widgetResult.result.grouped ? [
                  {
                    label: 'Collapse all groups',
                    icon: <ChevronUpIcon />,
                    onSelect: () => useListWidgetStore.getState().setCollapsed(menuTab.id, widgetResult.result.sections.map((sec) => sec.key)),
                  },
                  {
                    label: 'Expand all groups',
                    icon: <ChevronDownIcon size={14} />,
                    onSelect: () => useListWidgetStore.getState().setCollapsed(menuTab.id, []),
                  },
                ] : []),
              ]
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
      {cellFace.fullOpen && active && !collapsed && (
        <WidgetFacePopover tab={active} anchorRef={cellRef} onClose={cellFace.closeFull} />
      )}
    </section>
  )
}
