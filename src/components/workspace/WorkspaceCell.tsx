import { useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { PersistedTodoItem } from '../../models'
import { getActiveTab, type LayoutCell } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { copyTasksRich } from '../../services/task-copy'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../overlays/ListDefinitionPickerPopup'
import { CellTabStrip } from './CellTabStrip'
import { WidgetBody } from './WidgetBody'
import { AddWidgetFlow } from './AddWidgetFlow'
import { ADDABLE_KINDS, kindLabel, useAddWidget, useTabTitle } from './widget-hooks'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseCellIcon,
  CloseIcon,
  MoreIcon,
  PlusIcon,
  SplitBelowIcon,
  SplitRightIcon,
  WidgetKindIcon,
} from './icons'
import { useTabDrag } from './workspace-drag'
import styles from './WorkspaceCell.module.css'

function anchorBelow(ref: RefObject<HTMLElement | null>): { x: number; y: number } {
  const r = ref.current?.getBoundingClientRect()
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 100, y: 100 }
}

interface WorkspaceCellProps {
  cell: LayoutCell
  style?: CSSProperties
}

/** An empty cell (right after a split): kind buttons, "or drag a tab here", and a close ×. */
function EmptyCell({ cell, style }: WorkspaceCellProps) {
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const add = useAddWidget()
  const drag = useTabDrag()
  const [listAnchor, setListAnchor] = useState<{ x: number; y: number } | null>(null)
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
        {ADDABLE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={styles.kindButton}
            onClick={(e) => {
              if (kind === 'lens') {
                const r = e.currentTarget.getBoundingClientRect()
                setListAnchor({ x: r.left, y: r.bottom + 4 })
                return
              }
              add(kind, { kind: 'cell', cellId: cell.id })
            }}
          >
            <span className={styles.kindButtonIcon}><WidgetKindIcon kind={kind} /></span>
            {kindLabel(kind)}
          </button>
        ))}
      </div>
      <span className={styles.emptyHint}>or drag a tab here</span>
      {listAnchor && (
        <AddWidgetFlow kind="lens" target={{ kind: 'cell', cellId: cell.id }} anchor={listAnchor} onClose={() => setListAnchor(null)} />
      )}
    </section>
  )
}

/** Scrim + three drop zones shown over a cell body while a tab is dragged over it. */
function DropZones({ zone, accepts }: { zone: 'top' | 'middle' | 'bottom'; accepts: boolean }) {
  const cls = (z: typeof zone) => `${styles.zone} ${accepts && zone === z ? styles.zoneActive : ''}`
  return (
    <div className={styles.zones} aria-hidden="true" data-testid="ws-drop-zones" data-active-zone={accepts ? zone : ''}>
      <div className={cls('top')}>New cell above</div>
      <div className={cls('middle')}><PlusIcon size={12} strokeWidth={2} /> Add as tab</div>
      <div className={cls('bottom')}>New cell below</div>
    </div>
  )
}

/** "Change widget → List": pick the list first, so a list tab always has one. */
function ChangeToListPicker({ tabId, anchor, onClose }: { tabId: string; anchor: { x: number; y: number }; onClose: () => void }) {
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  return (
    <ListDefinitionPickerPopup
      x={anchor.x}
      y={anchor.y}
      header="Show list"
      onSelect={(id) => changeTabKind(tabId, 'lens', { listDefinitionId: id })}
      onCreateNew={() => useUIStore.getState().openListsEditor()}
      onClose={onClose}
    />
  )
}

export function WorkspaceCell({ cell, style }: WorkspaceCellProps) {
  if (cell.tabs.length === 0) return <EmptyCell cell={cell} style={style} />
  return <FilledCell cell={cell} style={style} />
}

function FilledCell({ cell, style }: WorkspaceCellProps) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const closeCell = useWorkspaceStore((s) => s.closeCell)
  const splitCell = useWorkspaceStore((s) => s.splitCell)
  const setCellCollapsed = useWorkspaceStore((s) => s.setCellCollapsed)
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  const patchTabConfig = useWorkspaceStore((s) => s.patchTabConfig)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const drag = useTabDrag()

  const active = getActiveTab(cell)
  const activeTitle = useTabTitle(active)
  const collapsed = cell.collapsed === true
  const [lens, setLens] = useState<{ tabId: string; count: number; todos: PersistedTodoItem[] } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [cellMenuOpen, setCellMenuOpen] = useState(false)
  const [addFlow, setAddFlow] = useState<{ anchor: { x: number; y: number } } | null>(null)
  const [changeToList, setChangeToList] = useState<{ tabId: string; anchor: { x: number; y: number } } | null>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)

  const activeCount = lens && lens.tabId === active?.id ? lens.count : undefined
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id!, s])), [statuses])

  const hit = drag?.hit
  const bodyHit = hit?.kind === 'cell-body' && hit.cellId === cell.id ? hit : null
  const stripHit = hit?.kind === 'tab-strip' && hit.cellId === cell.id && drag?.accepts ? hit : null
  const ghost = bodyHit && bodyHit.zone === 'middle' && drag?.accepts ? { kind: drag.kind, title: drag.title } : null

  const menuTab = tabMenu ? cell.tabs.find((t) => t.id === tabMenu.tabId) : undefined

  const cellMenuEntries: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Add widget',
      icon: <PlusIcon />,
      submenu: true,
      onSelect: () => setAddFlow({ anchor: anchorBelow(moreRef) }),
    },
    { kind: 'item', label: 'Split right', icon: <SplitRightIcon />, onSelect: () => { splitCell(cell.id, 'right') } },
    { kind: 'item', label: 'Split below', icon: <SplitBelowIcon />, onSelect: () => { splitCell(cell.id, 'below') } },
    {
      kind: 'item',
      label: collapsed ? 'Expand cell' : 'Collapse cell',
      icon: collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon />,
      onSelect: () => { void setCellCollapsed(cell.id, !collapsed) },
    },
    { kind: 'separator' },
    ...(active ? [{ kind: 'item' as const, label: `Close tab “${activeTitle}”`, icon: <CloseIcon size={14} strokeWidth={1.6} />, onSelect: () => closeTab(active.id) }] : []),
    {
      kind: 'item',
      label: `Close cell (${cell.tabs.length} ${cell.tabs.length === 1 ? 'tab' : 'tabs'})`,
      icon: <CloseCellIcon />,
      onSelect: () => closeCell(cell.id),
    },
  ]

  return (
    <section
      className={`${styles.cell} ${collapsed ? styles.collapsed : ''}`}
      style={style}
      data-ws-cell={cell.id}
      aria-label={`${activeTitle} cell`}
    >
      <div
        className={`${styles.header} ${cellMenuOpen ? styles.headerMenuOpen : ''}`}
        data-ws-cell-header={cell.id}
      >
        <CellTabStrip
          cell={cell}
          collapsed={collapsed}
          activeCount={activeCount}
          ghost={ghost}
          onActivate={(tabId) => {
            void setActiveTab(tabId)
            if (collapsed) void setCellCollapsed(cell.id, false)
          }}
          onClose={(tabId) => closeTab(tabId)}
          onOpenTabMenu={(tabId, p) => setTabMenu({ tabId, ...p })}
          onAddTab={(ref) => setAddFlow({ anchor: anchorBelow(ref) })}
        />
        {stripHit && drag?.insertLeft != null && (
          <span className={styles.insertLine} style={{ left: drag.insertLeft }} aria-hidden="true" data-testid="ws-tab-insert-line" />
        )}
        {collapsed ? (
          <button
            type="button"
            className={styles.expand}
            aria-label="Expand cell"
            aria-expanded={false}
            title="Expand cell"
            onClick={() => { void setCellCollapsed(cell.id, false) }}
          >
            <ChevronDownIcon size={14} />
          </button>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              aria-label="Collapse cell"
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
              aria-label="Cell options"
              aria-haspopup="menu"
              aria-expanded={cellMenuOpen}
              title="Cell options"
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
            onLensResult={(count, todos) => setLens({ tabId: active.id, count, todos })}
          />
          {bodyHit && <DropZones zone={bodyHit.zone} accepts={drag?.accepts === true} />}
        </div>
      )}

      {cellMenuOpen && (
        <MenuPopover
          anchorRef={moreRef}
          placement="bottom-end"
          width={232}
          label="Cell options"
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
          onChangeKind={(kind) => {
            if (kind === menuTab.kind) return
            if (kind === 'lens') {
              setChangeToList({ tabId: menuTab.id, anchor: { x: tabMenu.x, y: tabMenu.y } })
              return
            }
            changeTabKind(menuTab.id, kind)
          }}
          pickListForLens={menuTab.kind === 'lens'
            ? (id) => patchTabConfig(menuTab.id, 'lens', { listDefinitionId: id })
            : undefined}
          onEditList={menuTab.kind === 'lens' && menuTab.config.listDefinitionId != null
            ? () => useUIStore.getState().openListEditorDialog(menuTab.config.listDefinitionId!)
            : undefined}
          widgetActions={menuTab.kind === 'lens' && lens && lens.tabId === menuTab.id
            ? [{
                label: 'Copy tasks',
                icon: '⧉',
                onSelect: () => { void copyTasksRich([{ todos: lens.todos }], { assignedPeopleMap, statusMap }) },
              }]
            : undefined}
          onClose={() => setTabMenu(null)}
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
