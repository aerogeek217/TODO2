import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { getActiveTab, isGlanceKind, tabListId, type LayoutTab } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { getUnsavedListIds } from '../../stores/list-draft-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWidgetKindMenuEntries, type WidgetKindMenuContent } from '../shared/widget-kind-menu-entries'
import { CellTabStrip, JoinPreviewStrip } from './CellTabStrip'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { AddWidgetFlow } from './AddWidgetFlow'
import type { AddWhere } from './add-widget-where'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import { layoutTabs } from '../../utils/workspace-layout-queries'
import { useTabTitle, useTabTitles } from './widget-hooks'
import { UnsavedPrompt } from './UnsavedPrompt'
import { MenuPopover } from '../shared/MenuPopover'
import { ChevronDownIcon, ChevronUpIcon, GripIcon, MoreIcon } from '../shared/icons'
import {
  useWorkspaceDrag,
  WORKSPACE_PANEL_DRAG,
  workspacePanelDragId,
  type WorkspacePanelDragData,
} from './workspace-drag'
import styles from './WorkspaceCell.module.css'
import type { WorkspaceCellProps } from './WorkspaceCell'
import { trackScrollEdges } from '../../utils/scroll-edges'
import { WidgetFaceContext } from '../../hooks/use-widget-face'
import { smallFaceClick, useCellFace } from './cell-face'
import { SmallFaceOpener, WidgetFacePopover } from './CellFaceParts'
import { transitionName, withViewTransition } from '../shared/view-transition'
import { cellMenuEntries, mergedCellMenu, useWidgetMenuContent, type GuardedRun } from './cell-menu'
import { CellControlsContext, TOP_LINE_ATTR, type CellControlsValue } from './cell-controls'
import { CellControls } from './WidgetTopLine'

function anchorBelow(ref: RefObject<HTMLElement | null>): { x: number; y: number } {
  const r = ref.current?.getBoundingClientRect()
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 }
}

/**
 * The strip header's empty space: drags the whole panel (5px to start, as a
 * tab), with a faint grip on header hover. Not focusable — the ⋯ menu's
 * Split, Merge and Insert are the keyboard way.
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

/** Before any menu is open: the widget part builds nothing. */
const NO_WIDGET_MENU: WidgetKindMenuContent = { onChangeKind: () => {} }

/** Where the ⋯ menu opens: under the ⋯ (`null`), or at a point (a right-click). */
type MenuAt = { x: number; y: number } | null

/**
 * Whether `target` is in a widget top line of `cell` — or, with `holding`
 * (the focused element, for the keyboard), holds one: a Number's button
 * holds its label row.
 */
function onTopLine(cell: HTMLElement, target: EventTarget | null, holding = false): boolean {
  if (!(target instanceof Element) || !cell.contains(target)) return false
  const line = target.closest(`[${TOP_LINE_ATTR}]`)
  if (line && cell.contains(line)) return true
  return holding && target.querySelector(`[${TOP_LINE_ATTR}]`) != null
}

/**
 * A cell of the layout's table holding tabs (D26 AA1): with one widget no
 * tab strip — the widget's own top line names it and holds the controls
 * slot (grip and ⋯, `CellControlsContext`); with two or more, the tab
 * strip, the panel handle, collapse and the ⋯ in its header. Either way the
 * ⋯ opens one merged menu (`cell-menu`): the widget's own entries, then the
 * cell's in the table's words (D26 board V). The active widget's body shows
 * at its face (D25 R).
 */
export function FilledCell({ cell, rowTrackIds, collapsed, fitRow = false, style }: WorkspaceCellProps) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const splitCell = useWorkspaceStore((s) => s.splitCell)
  const mergeCells = useWorkspaceStore((s) => s.mergeCells)
  const insertTrack = useWorkspaceStore((s) => s.insertTrack)
  const setTrackCollapsed = useWorkspaceStore((s) => s.setTrackCollapsed)
  const drag = useWorkspaceDrag()
  const setRowCollapsed = useCallback((next: boolean) => { void setTrackCollapsed(rowTrackIds, next) }, [setTrackCollapsed, rowTrackIds])
  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  /** Tabs only when there's a choice (D26 AA1): one widget's top line names it. */
  const stripShown = cell.tabs.length > 1
  // The active widget's face (D25 R): a fit row's is small; a collapsed
  // one-widget cell shows its top line, which is its large face's first line.
  const cellFace = useCellFace(active, { forced: fitRow ? 'small' : collapsed && !stripShown ? 'large' : undefined })
  const smallFace = cellFace.face === 'small' && !collapsed
  const cellRef = useRef<HTMLElement | null>(null)
  /** What the active tab's widget last reported (any kind): its count label, shown sections or summary. */
  const [widgetResult, setWidgetResult] = useState<{ tabId: string; result: WidgetResult } | null>(null)
  const [guard, setGuard] = useState<{ listIds: number[]; lead: string; run: () => void } | null>(null)
  const [menu, setMenu] = useState<{ tabId: string; at: MenuAt } | null>(null)
  const [addFlow, setAddFlow] = useState<{ anchor: { x: number; y: number }; where: AddWhere } | null>(null)
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
  /**
   * The widget's top lines mounted, and those holding the controls slot: with
   * none holding it, the cell draws its own (a face without one); with no top
   * line at all, that one stands for the tab too.
   */
  const [claims, setClaims] = useState({ lines: 0, slots: 0 })
  const claim = useCallback((holdsSlot: boolean) => {
    const step = (d: number) => setClaims((c) => ({ lines: c.lines + d, slots: c.slots + (holdsSlot ? d : 0) }))
    step(1)
    return () => step(-1)
  }, [])

  const activeResult = widgetResult && widgetResult.tabId === active?.id ? widgetResult.result : undefined
  const activeCount = activeResult?.countLabel

  /** Runs `run`, first asking about unsaved lists that would lose their last widget with `tabIds`. */
  const guarded: GuardedRun = (tabIds, lead, run) => {
    const listIds = listsLosingLastWidget(tabIds)
    if (listIds.length === 0) run()
    else setGuard({ listIds, lead, run })
  }
  const closeTabGuarded = (tabId: string) => guarded([tabId], 'You’re closing the last widget that shows it.', () => closeTab(tabId))
  const closeCellGuarded = () => guarded(cell.tabs.map((t) => t.id), 'You’re closing the last widget that shows them.', () => closeCell(cell.id))

  const hit = drag?.hit
  const stripHit = hit?.kind === 'tab-strip' && hit.cellId === cell.id && drag?.accepts ? hit : null
  // Joining it (its body's middle): the tabs show in its strip as ghosts —
  // a one-widget cell's in the strip it will have, over its top line.
  const joining = drag?.accepts === true && hit?.kind === 'cell-body' && hit.cellId === cell.id && hit.zone === 'middle'
  const ghosts = joining ? drag.tabs : null
  const isDragSource = drag?.source.type === 'panel' && drag.source.panelId === cell.id

  // ── The merged ⋯ menu ──
  const menuTab = menu ? cell.tabs.find((t) => t.id === menu.tabId) : undefined
  const menuTitle = useTabTitle(menuTab)
  const widgetContent = useWidgetMenuContent(menuTab, menuTab && widgetResult?.tabId === menuTab.id ? widgetResult.result : undefined, guarded)
  const widgetEntries = useWidgetKindMenuEntries(widgetContent ?? NO_WIDGET_MENU)
  const menuEntries = menu && menuTab
    ? mergedCellMenu(widgetEntries, cellMenuEntries({
        cell,
        tab: menuTab,
        tabTitle: menuTitle,
        collapsed,
        onAddWidget: () => setAddFlow({ anchor: menu.at ?? anchorBelow(moreRef), where: 'tab' }),
        onSplit: (side) => { splitCell(cell.id, side) },
        onMerge: (other) => { mergeCells(cell.id, other) },
        onInsert: (edge) => { insertTrack(edge) },
        onCollapse: setRowCollapsed,
        onCloseTab: closeTabGuarded,
        onCloseCell: closeCellGuarded,
      }))
    : null
  const openMenu = useCallback((tabId: string, at: MenuAt) => setMenu({ tabId, at }), [])
  const menuOpen = menu != null || addFlow != null

  // A one-widget cell's controls slot, lent to its widget's top line.
  const activeId = active?.id
  const controls = useMemo<CellControlsValue | null>(() => (stripShown || activeId == null ? null : {
    cellId: cell.id,
    tabs: cell.tabs,
    tabId: activeId,
    title: activeTitle,
    touch: false,
    setMoreButton,
    menuOpen,
    onMore: () => setMenu((m) => (m ? null : { tabId: activeId, at: null })),
    collapsed,
    onExpand: () => setRowCollapsed(false),
    claim,
  }), [stripShown, activeId, cell.id, cell.tabs, activeTitle, menuOpen, collapsed, setRowCollapsed, claim, setMoreButton])

  /** A right-click on the top line (a glance widget's: anywhere on it) opens the ⋯ menu there. */
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    if (stripShown || e.defaultPrevented || !active) return
    // Not one from the full widget's popover (portaled, but in this React tree).
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return
    if (!isGlanceKind(active.kind) && !onTopLine(e.currentTarget, e.target)) return
    e.preventDefault()
    openMenu(active.id, { x: e.clientX, y: e.clientY })
  }
  /** Shift+F10 / the Menu key on the top line opens the ⋯ menu under the ⋯ (a widget's own menu, e.g. a row's, goes first). */
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (stripShown || e.defaultPrevented || !active) return
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
    if (!onTopLine(e.currentTarget, e.target, true)) return
    e.preventDefault()
    openMenu(active.id, null)
  }

  return (
    <section
      ref={cellRef}
      className={[
        styles.cell,
        collapsed ? styles.collapsed : '',
        isDragSource ? styles.dragSource : '',
      ].join(' ')}
      style={{ ...style, viewTransitionName: transitionName('ws-cell', cell.id) }}
      data-ws-cell={cell.id}
      data-ws-cell-title={activeTitle}
      data-face={!collapsed && active ? cellFace.face : undefined}
      aria-label={`${activeTitle} cell`}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {stripShown && (
        <div
          className={[styles.header, menuOpen ? styles.headerMenuOpen : ''].join(' ')}
          data-ws-cell-header={cell.id}
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
                if (collapsed) setRowCollapsed(false)
              })
            }}
            onClose={closeTabGuarded}
            onOpenTabMenu={(tabId, p) => openMenu(tabId, p)}
            onAddTab={(ref) => setAddFlow({ anchor: anchorBelow(ref), where: 'tab' })}
          />
          {stripHit && drag?.insertLeft != null && (
            <span className={styles.insertLine} style={{ left: drag.insertLeft }} aria-hidden="true" data-testid="ws-tab-insert-line" />
          )}
          <PanelHandle panelId={cell.id} tabs={cell.tabs} />
          {collapsed ? (
            <button
              type="button"
              className={styles.expand}
              aria-label="Expand row"
              aria-expanded={false}
              title="Expand row"
              onClick={() => setRowCollapsed(false)}
            >
              <ChevronDownIcon size={14} />
            </button>
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                aria-label="Collapse row"
                aria-expanded={true}
                title="Collapse"
                onClick={() => setRowCollapsed(true)}
              >
                <ChevronUpIcon />
              </button>
              <button
                ref={setMoreButton}
                type="button"
                className={`${styles.action} ${menu?.at === null ? styles.actionPressed : ''}`}
                aria-label="Cell options"
                aria-haspopup="menu"
                aria-expanded={menu != null}
                title="Cell options"
                onClick={() => setMenu((m) => (m ? null : active ? { tabId: active.id, at: null } : null))}
              >
                <MoreIcon />
              </button>
            </div>
          )}
        </div>
      )}
      {!stripShown && active && ghosts && <JoinPreviewStrip tab={active} ghosts={ghosts} />}
      {(!collapsed || !stripShown) && active && (
        <div className={styles.bodyFrame}>
          <div
            ref={collapsed ? undefined : trackScrollEdges}
            className={`${styles.body} ${smallFace ? styles.bodySmall : ''}`}
            role={stripShown ? 'tabpanel' : undefined}
            aria-labelledby={stripShown ? `ws-tab-${active.id}` : undefined}
            data-ws-cell-body={cell.id}
            // A small face opens its full widget (a widget's own click goes first).
            onClick={drag || collapsed ? undefined : smallFaceClick(cellFace)}
          >
            {smallFace && !drag && <SmallFaceOpener title={activeTitle} open={cellFace.fullOpen} onOpen={cellFace.openFull} />}
            <CellControlsContext.Provider value={controls}>
              <WidgetFaceContext.Provider value={cellFace.host}>
                <WidgetBody
                  key={active.id}
                  tab={active}
                  onResult={(result) => setWidgetResult({ tabId: active.id, result })}
                />
              </WidgetFaceContext.Provider>
            </CellControlsContext.Provider>
          </div>
        </div>
      )}
      {controls && claims.slots === 0 && <CellControls value={controls} floating standsForTab={claims.lines === 0} />}

      {menu && menuEntries && (
        <MenuPopover
          {...(menu.at ? { point: menu.at, restoreFocus: true } : { anchorRef: moreRef, placement: 'bottom-end' as const })}
          width={248}
          label="Cell options"
          entries={menuEntries}
          onClose={() => setMenu(null)}
        />
      )}
      {addFlow && (
        <AddWidgetFlow
          cellId={cell.id}
          initialWhere={addFlow.where}
          anchor={addFlow.anchor}
          onClose={() => setAddFlow(null)}
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
