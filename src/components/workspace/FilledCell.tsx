import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { getActiveTab, isGlanceKind, type LayoutTab } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { OPEN_LARGER_LABEL, widgetKindMenuEntries, type WidgetKindMenuContent } from '../shared/widget-kind-menu-entries'
import { CellTabStrip, JoinPreviewStrip } from './CellTabStrip'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { AddWidgetFlow } from './AddWidgetFlow'
import type { AddWhere } from './add-widget-where'
import { useTabTitle, useTabTitles } from './widget-hooks'
import { MenuPopover } from '../shared/MenuPopover'
import { ChevronDownIcon, ChevronUpIcon, ExpandIcon, MoreIcon } from '../shared/icons'
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
import { SmallFaceOpener } from './CellFaceParts'
import { openWidgetLarger } from '../../services/widget-popup'
import { tabOpensLarger } from '../../utils/widget-face'
import { transitionName, withViewTransition } from '../shared/view-transition'
import { CELL_MENU_LABEL, cellMenuFor, useWidgetMenuContent, type CellMenuPart } from './cell-menu'
import { CellControlsContext, TOP_LINE_ATTR, type CellControlsValue } from './cell-controls'
import { CellControls, CellGrip } from './WidgetTopLine'
import { TabNameIconPopover } from './TabNameIconPopover'

function anchorBelow(ref: RefObject<HTMLElement | null>): { x: number; y: number } {
  const r = ref.current?.getBoundingClientRect()
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 }
}

/**
 * The strip header's empty space: drags the whole panel (5px to start, as a
 * tab); a click there opens nothing (J15). Not focusable — the header's grip
 * button, beside the ⋯, drags too and opens the cell's layout menu.
 */
function PanelHandle({ panelId, tabs }: { panelId: string; tabs: readonly LayoutTab[] }) {
  const titles = useTabTitles(tabs)
  const data: WorkspacePanelDragData = {
    type: WORKSPACE_PANEL_DRAG,
    panelId,
    tabs: tabs.map((t, i) => ({ id: t.id, kind: t.kind, title: titles[i] ?? '', ...(t.icon ? { icon: t.icon } : {}) })),
  }
  const { setNodeRef, listeners } = useDraggable({ id: workspacePanelDragId(panelId), data })
  return (
    <div ref={setNodeRef} {...listeners} className={styles.fill} data-ws-panel-handle={panelId} data-strip-room="" aria-hidden="true" />
  )
}

/** Before any menu is open: the widget part builds nothing. */
const NO_WIDGET_MENU: WidgetKindMenuContent = { onChangeKind: () => {} }

/** Where a menu opens: under its button (`null`: the ⋯, the grip's under the grip), or at a point (a right-click). */
type MenuAt = { x: number; y: number } | null

/**
 * The buttons of one kind a cell draws (the strip's header's, a top line's
 * slot, the cell's own while no top line holds one — briefly two): a menu
 * anchors to the one still in the page.
 */
function useButtonSet() {
  const [els] = useState(() => new Set<HTMLButtonElement>())
  const ref = useMemo(() => ({
    get current(): HTMLButtonElement | null {
      for (const el of els) if (el.isConnected) return el
      return null
    },
  }), [els])
  const set = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return undefined
    els.add(el)
    return () => { els.delete(el) }
  }, [els])
  return [ref, set] as const
}

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
 * strip, the panel handle, the grip, collapse and the ⋯ in its header.
 * Either way (`cell-menu`, UX cleanup 4A) the ⋯ opens the widget's own
 * entries and Add widget…, the grip the cell's layout entries in the table's
 * words (D26 board V), and a right-click or Shift+F10 the whole menu. The
 * active widget's body shows at its face (D25 R).
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
  const [menu, setMenu] = useState<{ tabId: string; at: MenuAt; part: CellMenuPart } | null>(null)
  const [addFlow, setAddFlow] = useState<{ anchor: { x: number; y: number }; where: AddWhere } | null>(null)
  /** Name and icon… (items 11, 14): the tab, and what its popover opens under (the tab, or the top line standing for it). */
  const [labelEdit, setLabelEdit] = useState<{ tabId: string; anchor: RefObject<HTMLElement | null> | { x: number; y: number } } | null>(null)
  const [moreRef, setMoreButton] = useButtonSet()
  const [gripRef, setGripButton] = useButtonSet()
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


  const hit = drag?.hit
  const stripHit = hit?.kind === 'tab-strip' && hit.cellId === cell.id && drag?.accepts ? hit : null
  // Joining it (its body's middle): the tabs show in its strip as ghosts —
  // a one-widget cell's in the strip it will have, over its top line.
  const joining = drag?.accepts === true && hit?.kind === 'cell-body' && hit.cellId === cell.id && hit.zone === 'middle'
  const ghosts = joining ? drag.tabs : null
  const isDragSource = drag?.source.type === 'panel' && drag.source.panelId === cell.id

  /** Opens Name and icon… for tab `tabId`: under the element standing for it in this cell (its tab, or its top line), else where the menu was. */
  const openLabelEdit = useCallback((tabId: string, at: MenuAt) => {
    const cellEl = document.querySelector(`[data-ws-cell="${CSS.escape(cell.id)}"]`)
    const el = cellEl?.querySelector<HTMLElement>(`[data-ws-tab="${CSS.escape(tabId)}"]:not([aria-hidden="true"])`) ?? null
    setLabelEdit({ tabId, anchor: el ? { current: el } : at ?? anchorBelow(moreRef) })
  }, [moreRef, cell.id])

  // ── The ⋯'s menu, the grip's, the whole one ──
  const menuTab = menu ? cell.tabs.find((t) => t.id === menu.tabId) : undefined
  const menuTitle = useTabTitle(menuTab)
  const widgetContent = useWidgetMenuContent(menuTab, menuTab && widgetResult?.tabId === menuTab.id ? widgetResult.result : undefined)
  // Open larger for the menu's tab: by the face it shows (the active tab's), a tab out of sight by its large face.
  const menuOpensLarger = menuTab != null && tabOpensLarger(menuTab, menuTab.id === active?.id ? cellFace.face : 'large')
  const menuEntries = menu && menuTab
    ? cellMenuFor(menu.part, widgetKindMenuEntries({
        ...(widgetContent ?? NO_WIDGET_MENU),
        onOpenLarger: menuOpensLarger ? () => { void openWidgetLarger(menuTab.id) } : undefined,
        onNameAndIcon: () => openLabelEdit(menuTab.id, menu.at),
      }), {
        cell,
        tab: menuTab,
        tabTitle: menuTitle,
        collapsed,
        onAddWidget: () => setAddFlow({ anchor: menu.at ?? anchorBelow(moreRef), where: 'tab' }),
        onSplit: (side) => { splitCell(cell.id, side) },
        onMerge: (other) => { mergeCells(cell.id, other) },
        onInsert: (edge) => { insertTrack(edge) },
        onCollapse: setRowCollapsed,
        onCloseTab: closeTab,
        onCloseCell: () => closeCell(cell.id),
      })
    : null
  /** The whole menu (a right-click, Shift+F10 / the Menu key): at a point, or under the ⋯. */
  const openMenu = useCallback((tabId: string, at: MenuAt) => setMenu({ tabId, at, part: 'all' }), [])
  /** The ⋯'s menu (`widget`) or the grip's (`layout`) for tab `tabId`, under its button; pressed again, closed. */
  const toggleMenu = useCallback((part: 'widget' | 'layout', tabId: string | undefined) => {
    setMenu((m) => (m && m.at === null && m.part === part ? null : tabId != null ? { tabId, at: null, part } : null))
  }, [])
  const menuOpen = menu != null || addFlow != null
  const gripOpen = menu?.part === 'layout'

  // A one-widget cell's controls slot, lent to its widget's top line.
  const activeId = active?.id
  const onOpenLarger = cellFace.opensLarger ? cellFace.openLarger : undefined
  const controls = useMemo<CellControlsValue | null>(() => (stripShown || activeId == null ? null : {
    cellId: cell.id,
    tabs: cell.tabs,
    tabId: activeId,
    title: activeTitle,
    touch: false,
    setMoreButton,
    menuOpen,
    moreOpen: menuOpen && !gripOpen,
    onMore: () => toggleMenu('widget', activeId),
    onGrip: () => toggleMenu('layout', activeId),
    onOpenLarger,
    gripOpen,
    setGripButton,
    collapsed,
    onExpand: () => setRowCollapsed(false),
    claim,
  }), [stripShown, activeId, cell.id, cell.tabs, activeTitle, menuOpen, gripOpen, onOpenLarger, collapsed, setRowCollapsed, claim, setMoreButton, setGripButton, toggleMenu])

  /** A right-click on the top line (a glance widget's: anywhere on it) opens the ⋯ menu there. */
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    if (stripShown || e.defaultPrevented || !active) return
    // Only one from inside the cell's own element.
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
            activeLens={activeResult?.tabLens}
            ghosts={ghosts}
            onActivate={(tabId) => {
              withViewTransition(() => {
                void setActiveTab(tabId)
                if (collapsed) setRowCollapsed(false)
              })
            }}
            onClose={closeTab}
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
              <CellGrip
                cellId={cell.id}
                tabs={cell.tabs}
                title={activeTitle}
                idSuffix=":header"
                expanded={gripOpen}
                onMenu={() => toggleMenu('layout', active?.id)}
                setButton={setGripButton}
                className={`${styles.action} ${styles.gripButton} ${gripOpen ? styles.actionPressed : ''}`}
              />
              {onOpenLarger && (
                <button
                  type="button"
                  className={styles.action}
                  aria-label={OPEN_LARGER_LABEL}
                  aria-haspopup="dialog"
                  title={OPEN_LARGER_LABEL}
                  data-testid="open-larger"
                  onClick={onOpenLarger}
                >
                  <ExpandIcon />
                </button>
              )}
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
                className={`${styles.action} ${menu?.at === null && !gripOpen ? styles.actionPressed : ''}`}
                aria-label="Cell options"
                aria-haspopup="menu"
                aria-expanded={menu != null && !gripOpen}
                title="Cell options"
                onClick={() => toggleMenu('widget', active?.id)}
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
            // A small face opens its widget larger (a widget's own click goes first).
            onClick={drag || collapsed ? undefined : smallFaceClick(cellFace)}
          >
            {smallFace && !drag && cellFace.opensLarger && <SmallFaceOpener title={activeTitle} open={cellFace.open} onOpen={cellFace.openLarger} />}
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
          {...(menu.at ? { point: menu.at, restoreFocus: true } : { anchorRef: menu.part === 'layout' ? gripRef : moreRef, placement: 'bottom-end' as const })}
          width={248}
          label={CELL_MENU_LABEL[menu.part]}
          entries={menuEntries}
          onClose={() => setMenu(null)}
        />
      )}
      {labelEdit && (
        <TabNameIconPopover tabId={labelEdit.tabId} anchor={labelEdit.anchor} onClose={() => setLabelEdit(null)} />
      )}
      {addFlow && (
        <AddWidgetFlow
          cellId={cell.id}
          initialWhere={addFlow.where}
          anchor={addFlow.anchor}
          onClose={() => setAddFlow(null)}
        />
      )}
    </section>
  )
}
