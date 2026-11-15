import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { getActiveTab, isGlanceKind, type LayoutTab } from '../../models/workspace-layout'
import { afterLeavingEditors, editorsHoldChanges } from '../../stores/editor-leave'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { OPEN_LARGER_LABEL, widgetKindMenuEntries, type WidgetKindMenuContent } from '../shared/widget-kind-menu-entries'
import { CellTabStrip, JoinPreviewStrip } from './CellTabStrip'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { AddWidgetFlow } from './AddWidgetFlow'
import type { AddWhere } from './add-widget-where'
import { useTabTitle, useTabTitles } from './widget-hooks'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { ChevronDownIcon, ChevronUpIcon, ExpandIcon, MoreIcon, PlusIcon } from '../shared/icons'
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
import { smallFaceClick, useCellFace, useHeldBodyHeight } from './cell-face'
import { SmallFaceOpener } from './CellFaceParts'
import { OpenLargerPlaceholder } from './OpenLargerPlaceholder'
import { openWidgetLarger } from '../../services/widget-popup'
import { tabOpensLarger } from '../../utils/widget-face'
import { transitionName, withViewTransition } from '../shared/view-transition'
import { CELL_MENU_LABEL, cellMenuFor, useWidgetMenuContent, type CellMenuPart } from './cell-menu'
import { CellControlsContext, TOP_LINE_ATTR, type CellControlsValue } from './cell-controls'
import { trackCellHot } from './cell-hot'
import { CellControls, CellGrip } from './WidgetTopLine'
import { TabNameIconPopover } from './TabNameIconPopover'
import { NumberStrip, NUMBER_SLOT_ATTR } from './NumberStrip'
import { isNumberStripCell } from '../../utils/workspace-rows'
import type { WidgetFace } from '../../utils/widget-face'

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

/**
 * After a tab switch that waited on an editor's question: the focus, back on
 * the strip's tab the key was pressed on (the question took it, so the
 * strip's own move to the new tab found it elsewhere), goes to the new tab —
 * where an arrow key leaves it when nothing asks. Only from another tab of
 * this cell's strip: a click's focus, or one that went elsewhere, stays.
 */
function focusSwitchedTab(cell: HTMLElement | null, tabId: string): void {
  const focused = document.activeElement
  if (!cell || !(focused instanceof HTMLElement) || focused.getAttribute('role') !== 'tab' || !cell.contains(focused)) return
  const next = document.getElementById(`ws-tab-${tabId}`)
  if (next && next !== focused && cell.contains(next) && !next.hasAttribute('data-ws-tab-folded')) next.focus()
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
 * strip, the panel handle, the grip, Open larger (the active widget's),
 * collapse and the ⋯ in its header.
 * Either way (`cell-menu`, UX cleanup 4A; layout menus option A) the ⋯
 * opens the widget's own entries and Remove widget, the grip every placement
 * (Add widget…, Split, Insert row / column, Merge, Collapse, Close cell),
 * and a right-click or Shift+F10 the whole menu. The
 * active widget's body shows at its face (D25 R) — while the widget popup
 * shows that tab (Open larger), a placeholder in its place: a tab has one
 * live widget at a time (`OpenLargerPlaceholder`).
 */
export function FilledCell({ cell, rowTrackIds, collapsed, fitRow = false, style }: WorkspaceCellProps) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const splitCell = useWorkspaceStore((s) => s.splitCell)
  const mergeCells = useWorkspaceStore((s) => s.mergeCells)
  const insertTrack = useWorkspaceStore((s) => s.insertTrack)
  const insertTrackBeside = useWorkspaceStore((s) => s.insertTrackBeside)
  const setTrackCollapsed = useWorkspaceStore((s) => s.setTrackCollapsed)
  const drag = useWorkspaceDrag()
  /**
   * Whatever here can take a widget off the screen — a tab switched or
   * closed, the row collapsed (or expanded: its neighbours shrink), the
   * menu's split, merge, insert and Close cell — asks an open editor holding
   * changes first (Edit list, a widget editor): Save / Discard / Keep editing
   * (`editor-leave`), as on every other way out of it; Save or Discard, then
   * it is done; Keep editing, nothing. With none it runs at once, in the same
   * tick. A press elsewhere has asked already (the editors' own rule): this
   * is the keyboard's way here, and a menu's.
   */
  const closeTabAsked = useCallback((tabId: string) => afterLeavingEditors(() => closeTab(tabId)), [closeTab])
  const setRowCollapsed = useCallback((next: boolean) => afterLeavingEditors(() => { void setTrackCollapsed(rowTrackIds, next) }), [setTrackCollapsed, rowTrackIds])
  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  /** Only Numbers, two or more (flair P10): one strip of them, side by side, no tab strip. */
  const numberStrip = isNumberStripCell(cell)
  /** Tabs only when there's a choice (D26 AA1): one widget's top line names it. */
  const stripShown = cell.tabs.length > 1 && !numberStrip
  // The active widget's face (D25 R): a fit row's is small; a collapsed
  // one-widget cell shows its top line, which is its large face's first line.
  const cellFace = useCellFace(active, { forced: fitRow ? 'small' : collapsed && !stripShown ? 'large' : undefined })
  const smallFace = cellFace.face === 'small' && !collapsed
  const cellRef = useRef<HTMLElement | null>(null)
  // The cell's element: kept for the focus hand-back, and marked `data-cell-hot` while hovered or holding
  // the focus — its hover-only controls show by that (`cell-hot`).
  const setCell = useCallback((el: HTMLElement | null) => {
    cellRef.current = el
    const stop = trackCellHot(el)
    return () => {
      cellRef.current = null
      stop?.()
    }
  }, [])
  // A fit row's height is its content's: the placeholder keeps the height its widget had.
  const [setHeldBody, heldHeight] = useHeldBodyHeight(active?.id, fitRow)
  const setBody = useCallback((el: HTMLDivElement | null) => {
    setHeldBody(el)
    const stop = collapsed ? undefined : trackScrollEdges(el)
    return () => {
      setHeldBody(null)
      stop?.()
    }
  }, [setHeldBody, collapsed])
  /** What each mounted widget last reported (any kind), by tab: its count label, shown sections or summary. */
  const [widgetResults, setWidgetResults] = useState<Readonly<Record<string, WidgetResult>>>({})
  const setWidgetResult = useCallback((tabId: string, result: WidgetResult) => setWidgetResults((r) => (r[tabId] === result ? r : { ...r, [tabId]: result })), [])
  /** A strip's Numbers' faces, by tab (the menu's Open larger). */
  const [slotFaces, setSlotFaces] = useState<Readonly<Record<string, WidgetFace>>>({})
  const setSlotFace = useCallback((tabId: string, face: WidgetFace) => setSlotFaces((f) => (f[tabId] === face ? f : { ...f, [tabId]: face })), [])
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

  const activeResult = active ? widgetResults[active.id] : undefined
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
  const widgetContent = useWidgetMenuContent(menuTab, menuTab ? widgetResults[menuTab.id] : undefined)
  // Open larger for the menu's tab: by the face it shows (the active tab's, a strip's Number's), a tab out of sight by its large face.
  const menuFace = menuTab == null ? 'large' : numberStrip ? (slotFaces[menuTab.id] ?? 'large') : menuTab.id === active?.id ? cellFace.face : 'large'
  const menuOpensLarger = menuTab != null && tabOpensLarger(menuTab, menuFace)
  const menuEntries = menu && menuTab
    ? cellMenuFor(menu.part, [...widgetKindMenuEntries({
        ...(widgetContent ?? NO_WIDGET_MENU),
        onOpenLarger: menuOpensLarger ? () => { void openWidgetLarger(menuTab.id) } : undefined,
        onNameAndIcon: () => openLabelEdit(menuTab.id, menu.at),
      }), ...numberEntries(menuTab)], {
        cell,
        tab: menuTab,
        tabTitle: menuTitle,
        collapsed,
        // From the grip (Layout): under the grip; from a right-click: where it was.
        onAddWidget: () => setAddFlow({ anchor: menu.at ?? anchorBelow(menu.part === 'layout' ? gripRef : moreRef), where: 'tab' }),
        onSplit: (side) => afterLeavingEditors(() => { splitCell(cell.id, side) }),
        onMerge: (other) => afterLeavingEditors(() => { mergeCells(cell.id, other) }),
        onInsert: (edge) => afterLeavingEditors(() => { insertTrack(edge) }),
        onInsertBeside: (side) => afterLeavingEditors(() => { insertTrackBeside(cell.id, side) }),
        onCollapse: setRowCollapsed,
        onCloseTab: closeTabAsked,
        onCloseCell: () => afterLeavingEditors(() => closeCell(cell.id)),
      })
    : null
  /**
   * A Number's own way to grow a strip (flair P10): Add number beside (a
   * lone Number becomes a strip of two). Remove widget (every widget's)
   * takes one out.
   */
  function numberEntries(tab: LayoutTab): MenuEntry[] {
    if (tab.kind !== 'number') return []
    const at = cell.tabs.findIndex((t) => t.id === tab.id)
    const entries: MenuEntry[] = [
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Add number beside',
        icon: <PlusIcon />,
        onSelect: () => { void useWorkspaceStore.getState().addWidget('number', { kind: 'cell', cellId: cell.id, index: at + 1 }) },
      },
    ]
    return entries
  }
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
  const controls = useMemo<CellControlsValue | null>(() => (stripShown || numberStrip || activeId == null ? null : {
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
  }), [stripShown, numberStrip, activeId, cell.id, cell.tabs, activeTitle, menuOpen, gripOpen, onOpenLarger, collapsed, setRowCollapsed, claim, setMoreButton, setGripButton, toggleMenu])

  /** A strip's Number under an event's target (its slot), else the active tab. */
  const eventTab = (target: EventTarget | null): LayoutTab | undefined => {
    if (!numberStrip || !(target instanceof Element)) return active
    const id = target.closest(`[${NUMBER_SLOT_ATTR}]`)?.getAttribute(NUMBER_SLOT_ATTR)
    return cell.tabs.find((t) => t.id === id) ?? active
  }

  /** A right-click on the top line (a glance widget's: anywhere on it) opens the ⋯ menu there. */
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const tab = eventTab(e.target)
    if (stripShown || e.defaultPrevented || !tab) return
    // Only one from inside the cell's own element.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return
    if (!isGlanceKind(tab.kind) && !onTopLine(e.currentTarget, e.target)) return
    e.preventDefault()
    openMenu(tab.id, { x: e.clientX, y: e.clientY })
  }
  /** Shift+F10 / the Menu key on the top line opens the ⋯ menu under the ⋯ (a widget's own menu, e.g. a row's, goes first). */
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const tab = eventTab(e.target)
    if (stripShown || e.defaultPrevented || !tab) return
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
    if (!onTopLine(e.currentTarget, e.target, true)) return
    e.preventDefault()
    // A strip's Number: under its own ⋯ (the cell's anchor is its first).
    openMenu(tab.id, numberStrip ? anchorBelow({ current: (e.target as Element).closest(`[${NUMBER_SLOT_ATTR}]`)?.querySelector<HTMLElement>('[aria-label="Cell options"]') ?? null }) : null)
  }

  return (
    <section
      ref={setCell}
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
            ghosts={ghosts}
            onActivate={(tabId) => {
              const show = () => withViewTransition(() => {
                void setActiveTab(tabId)
                if (collapsed) setRowCollapsed(false)
              })
              // The tab already shown changes nothing: nothing to ask about.
              if ((tabId === active?.id && !collapsed) || !editorsHoldChanges()) show()
              else afterLeavingEditors(() => { show(); focusSwitchedTab(cellRef.current, tabId) })
            }}
            onClose={closeTabAsked}
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
                  className={`${styles.action} ${styles.openLarger}`}
                  aria-label={OPEN_LARGER_LABEL}
                  aria-haspopup="dialog"
                  title={OPEN_LARGER_LABEL}
                  data-testid="open-larger"
                  onClick={onOpenLarger}
                >
                  <ExpandIcon size={13} />
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
      {!stripShown && !numberStrip && active && ghosts && <JoinPreviewStrip tab={active} ghosts={ghosts} />}
      {numberStrip && (
        <div className={styles.bodyFrame} data-ws-cell-body={cell.id}>
          <NumberStrip
            cell={cell}
            smallFaces={fitRow || collapsed}
            dragging={drag != null}
            menuTabId={menu && menu.part !== 'layout' ? menu.tabId : null}
            onMore={(tabId, button) => setMenu((m) => (m && m.tabId === tabId && m.part === 'widget' ? null : { tabId, at: anchorBelow({ current: button }), part: 'widget' }))}
            onClose={closeTabAsked}
            onAdd={() => { void useWorkspaceStore.getState().addWidget('number', { kind: 'cell', cellId: cell.id }) }}
            onResult={setWidgetResult}
            onFace={setSlotFace}
          />
          {stripHit && drag?.insertLeft != null && (
            <span className={styles.stripInsertLine} style={{ left: drag.insertLeft }} aria-hidden="true" data-testid="ws-tab-insert-line" />
          )}
          {/* The strip's grip: drags the whole cell, a click its layout menu. */}
          <span className={styles.stripGrip}>
            <CellGrip
              cellId={cell.id}
              tabs={cell.tabs}
              title={activeTitle}
              idSuffix=":floating"
              expanded={gripOpen}
              onMenu={() => toggleMenu('layout', active?.id)}
              setButton={setGripButton}
              panelHandle
              className={`${styles.action} ${styles.gripButton} ${gripOpen ? styles.actionPressed : ''}`}
            />
          </span>
        </div>
      )}
      {!numberStrip && (!collapsed || !stripShown) && active && (
        <div className={styles.bodyFrame}>
          <div
            ref={setBody}
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
                {cellFace.open ? (
                  // The popup shows this tab: its one live widget is there.
                  <OpenLargerPlaceholder tabId={active.id} title={activeTitle} compact={smallFace} minHeight={heldHeight} />
                ) : (
                  <WidgetBody
                    key={active.id}
                    tab={active}
                    onResult={(result) => setWidgetResult(active.id, result)}
                  />
                )}
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
