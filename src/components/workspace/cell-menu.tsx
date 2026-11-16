import {
  isGlanceTab,
  tabListId,
  WIDGET_KIND_GROUPS,
  WIDGET_KIND_SPECS,
  widgetKindLabel,
  widgetKindsOf,
  type LayoutCell,
  type LayoutTab,
  type WidgetKind,
} from '../../models/workspace-layout'
import { BREAKDOWN_PRESET_LABELS, BREAKDOWN_PRESETS, type BreakdownPreset } from '../../models/chart-widgets'
import { afterLeavingEditors } from '../../stores/editor-leave'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { copyTasks } from '../../services/task-copy'
import type { MenuEntry, MenuItemEntry } from '../shared/MenuPopover'
import type { WidgetKindMenuContent, WidgetMenuAction } from '../shared/widget-kind-menu-entries'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseCellIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  SplitBelowIcon,
  SplitRightIcon,
  WidgetKindIcon,
} from '../shared/icons'
import { mergeNeighbour, type Side } from '../../utils/workspace-grid'
import { tabsCount } from './workspace-drag'
import type { WidgetResult } from './WidgetBody'
import { useNeglectMenuEntries } from './neglect/neglect-menu'
import { glanceMenu } from './glance/glance-menu'
import { useListZoomMenuEntries } from './list/zoom-menu'
import { useListReviewMenuEntries } from './list/review-menu'
import { createListAndTab, openEditList, useListOwnerLayoutId } from './widget-hooks'

/**
 * A cell's menus (D26 AA1, UX cleanup 4A; layout edit mode E4). The rule:
 * **edit mode changes the grid; what's inside a cell changes in place.**
 * Outside the mode the ⋯ (**Cell options**) — and a right-click on a
 * widget's top line or a tab, or Shift+F10 / the Menu key there — is this
 * widget and its cell's contents: the widget's own entries under its kind's
 * heading (Edit list…, Zoom, Copy…, Open larger, Name and icon…, Change
 * widget ›), then **Add widget as tab ›** (every kind, under Tasks and
 * Insights), **Remove widget** (a lone widget's cell stays, empty),
 * Collapse / Expand row, and last **Edit layout**, which opens the layout
 * edit mode with this cell selected. Inside the mode every one of the
 * cell's menus — the grip's (**Cell layout**) among them, which only the
 * mode draws — holds the cell's layout entries under Layout: Add widget…,
 * Split cell ▸, Insert row ▸, Insert column ▸, Merge with ▸ (each side its
 * own entry), Collapse row, then Close cell (no widget editors or popups
 * over the draft).
 */

/** Merge with ▸ a side: why the item is off when the cell doesn't merge that way. */
export const NO_MERGE_REASON = 'Only cells that make a rectangle together merge'

/** Split cell ▸ and Merge with ▸: the four sides, in reading order. */
const SIDE_ITEMS: ReadonlyArray<{ label: string; side: Side }> = [
  { label: 'Above', side: 'top' },
  { label: 'Left', side: 'left' },
  { label: 'Right', side: 'right' },
  { label: 'Below', side: 'bottom' },
]

/** The cell across `side` that cell `cellId` merges with into a rectangle (Merge with ▸), in the open layout. */
function mergeTarget(cellId: string, side: Side): string | undefined {
  const layout = useWorkspaceStore.getState().working
  return layout ? mergeNeighbour(layout, cellId, side)?.id : undefined
}

/** What the cell's own part of the menu acts on. */
export interface CellMenuActions {
  cell: Pick<LayoutCell, 'id' | 'tabs'>
  /** The tab Remove widget removes (the menu's widget). */
  tab: LayoutTab | undefined
  /** Its title. */
  tabTitle: string
  /** Every row track it covers is collapsed: Expand row instead of Collapse row. */
  collapsed: boolean
  onAddWidget: () => void
  onSplit: (side: Side) => void
  onMerge: (otherCellId: string) => void
  /** A row / column at the layout's edge. */
  onInsert: (edge: Side) => void
  /** A row / column beside this cell's own (Above / Below this row, Left / Right of this column). */
  onInsertBeside: (side: Side) => void
  onCollapse: (next: boolean) => void
  onCloseTab: (tabId: string) => void
  /** Add widget as tab › a kind (a Breakdown with its preset): a new tab of this cell, made its active one. */
  onAddTab: (kind: WidgetKind, preset?: BreakdownPreset) => void
  onCloseCell: () => void
  /** Edit layout (the ⋯'s last entry): opens the layout edit mode with this cell selected. Absent: no entry. */
  onEditLayout?: () => void
  /** The layout edit mode is on: every menu of the cell is its layout entries. */
  editing?: boolean
  /** Look up the cell Merge with ▸ would take that way (default: in the open layout). */
  mergeWith?: (cellId: string, side: Side) => string | undefined
}

/** Add widget… (the first entry under Layout). */
function addWidgetEntry(a: CellMenuActions): MenuEntry {
  return { kind: 'item', label: 'Add widget…', icon: <PlusIcon />, submenu: true, onSelect: a.onAddWidget }
}

/**
 * The cell's layout entries (the grip's menu, under Layout): Add widget…,
 * Split cell ▸ and Merge with ▸ on every side, Insert row ▸ (beside this
 * cell's row, or at the layout's top / bottom), Insert column ▸ (beside this
 * cell's column, or at its far left / right), Collapse row, then Close cell.
 */
function cellLayoutEntries(a: CellMenuActions): MenuEntry[] {
  const mergeWith = a.mergeWith ?? mergeTarget
  const several = a.cell.tabs.length > 1
  const sub = (label: string, onSelect: () => void): MenuEntry => ({ kind: 'item', label, onSelect })
  return [
    addWidgetEntry(a),
    {
      kind: 'item',
      label: 'Split cell',
      icon: <SplitRightIcon />,
      children: SIDE_ITEMS.map(({ label, side }) => sub(label, () => a.onSplit(side))),
    },
    {
      kind: 'item',
      label: 'Insert row',
      icon: <SplitBelowIcon />,
      children: [
        sub('Above this row', () => a.onInsertBeside('top')),
        sub('Below this row', () => a.onInsertBeside('bottom')),
        { kind: 'separator' },
        sub('At the top', () => a.onInsert('top')),
        sub('At the bottom', () => a.onInsert('bottom')),
      ],
    },
    {
      kind: 'item',
      label: 'Insert column',
      icon: <SplitRightIcon />,
      children: [
        sub('Left of this column', () => a.onInsertBeside('left')),
        sub('Right of this column', () => a.onInsertBeside('right')),
        { kind: 'separator' },
        sub('At the far left', () => a.onInsert('left')),
        sub('At the far right', () => a.onInsert('right')),
      ],
    },
    {
      kind: 'item',
      label: 'Merge with',
      children: SIDE_ITEMS.map(({ label, side }): MenuEntry => {
        const other = mergeWith(a.cell.id, side)
        return {
          kind: 'item',
          label,
          disabled: other == null,
          title: other == null ? NO_MERGE_REASON : undefined,
          onSelect: () => { if (other) a.onMerge(other) },
        }
      }),
    },
    {
      kind: 'item',
      label: a.collapsed ? 'Expand row' : 'Collapse row',
      icon: a.collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon />,
      onSelect: () => a.onCollapse(!a.collapsed),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: several ? `Close cell (${tabsCount(a.cell.tabs.length)})` : 'Close cell',
      icon: <CloseCellIcon />,
      onSelect: a.onCloseCell,
    },
  ]
}

/** The width of Add widget as tab ›'s submenus. */
const ADD_TAB_SUBMENU_WIDTH_PX = 240

/**
 * Add widget as tab › (outside the mode): every kind, by group under its
 * caption (Tasks, Insights) as Add widget lists them; a Breakdown opens its
 * presets. A pick adds that widget as a new tab of this cell.
 */
function addTabEntry(a: CellMenuActions): MenuEntry {
  const kindItem = (kind: WidgetKind): MenuItemEntry => (kind === 'breakdown'
    ? {
        kind: 'item',
        label: widgetKindLabel(kind),
        icon: <WidgetKindIcon kind={kind} />,
        childrenWidth: ADD_TAB_SUBMENU_WIDTH_PX,
        children: [
          { kind: 'label', text: widgetKindLabel(kind) },
          ...BREAKDOWN_PRESETS.map((preset): MenuEntry => ({ kind: 'item', label: BREAKDOWN_PRESET_LABELS[preset], onSelect: () => a.onAddTab(kind, preset) })),
        ],
      }
    : { kind: 'item', label: widgetKindLabel(kind), icon: <WidgetKindIcon kind={kind} />, onSelect: () => a.onAddTab(kind) })
  return {
    kind: 'item',
    label: 'Add widget as tab',
    icon: <PlusIcon />,
    childrenWidth: ADD_TAB_SUBMENU_WIDTH_PX,
    children: WIDGET_KIND_GROUPS.flatMap(({ group, label }, i): MenuEntry[] => [
      ...(i > 0 ? [{ kind: 'separator' } as const] : []),
      { kind: 'label', text: label },
      ...widgetKindsOf(group).map(kindItem),
    ]),
  }
}

/** Collapse / Expand row (outside the mode, in the ⋯: view state). */
function collapseEntry(a: CellMenuActions): MenuEntry {
  return {
    kind: 'item',
    label: a.collapsed ? 'Expand row' : 'Collapse row',
    icon: a.collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon />,
    onSelect: () => a.onCollapse(!a.collapsed),
  }
}

/** Remove widget (outside the mode): removes this widget's tab — a lone widget's cell stays, empty (`workspace-store.removeWidget`). */
function removeWidgetEntry(a: CellMenuActions): MenuEntry[] {
  const tab = a.tab
  if (!tab) return []
  return [{ kind: 'item', label: 'Remove widget', icon: <CloseIcon size={14} strokeWidth={1.6} />, onSelect: () => a.onCloseTab(tab.id) }]
}

/** Edit layout (the ⋯'s last entry): the layout edit mode, this cell selected. */
function editLayoutEntry(a: CellMenuActions): MenuEntry[] {
  const open = a.onEditLayout
  return open ? [{ kind: 'item', label: 'Edit layout', icon: <PencilIcon />, onSelect: open }] : []
}

/** The cell's section of the whole menu, under its heading (Layout): the layout entries ({@link cellLayoutEntries}). */
export function cellMenuEntries(a: CellMenuActions): MenuEntry[] {
  return [{ kind: 'label', text: 'Layout' }, ...cellLayoutEntries(a)]
}

/**
 * Which of a cell's menus is open: the ⋯'s (`widget`), the grip's (`layout`:
 * the layout entries under Layout — the grip shows only in the layout edit
 * mode), or the whole menu (`all`: a right-click, Shift+F10 / the Menu key).
 * Outside the mode `widget` and `all` are the same menu.
 */
export type CellMenuPart = 'widget' | 'layout' | 'all'

/** Each menu's name (its `aria-label`; the ⋯'s and the grip's are their buttons' too). */
export const CELL_MENU_LABEL: Readonly<Record<CellMenuPart, string>> = {
  widget: 'Cell options',
  layout: 'Cell layout',
  all: 'Cell options',
}

/**
 * The entries of the cell's menu `part`, from the widget's entries and the
 * cell's actions. In the layout edit mode (and the grip's, only drawn
 * there): the layout entries. Outside it: the widget's entries, then Add
 * widget as tab ›, Remove widget and Collapse / Expand row, then Edit layout.
 */
export function cellMenuFor(part: CellMenuPart, widget: readonly MenuEntry[], a: CellMenuActions): MenuEntry[] {
  if (part === 'layout' || a.editing) return cellMenuEntries(a)
  const own = mergedCellMenu(widget, [addTabEntry(a), ...removeWidgetEntry(a), collapseEntry(a)])
  return mergedCellMenu(own, editLayoutEntry(a))
}

/** The widget's entries, a separator, the cell's (no separator doubled or left at an end). */
export function mergedCellMenu(widget: readonly MenuEntry[], cell: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const entry of [...widget, { kind: 'separator' } as const, ...cell]) {
    if (entry.kind === 'separator' && (out.length === 0 || out.at(-1)?.kind === 'separator')) continue
    out.push(entry)
  }
  if (out.at(-1)?.kind === 'separator') out.pop()
  return out
}

/**
 * The widget part of the ⋯ menu for `tab` (what its tab menu had): its
 * list's Edit list…, its settings, its actions (Copy, Collapse / Expand
 * all groups), then Change widget.
 * `result` is what the cell's active widget last reported (its Copy lines,
 * a list's sections); `undefined` content when there is no tab.
 */
export function useWidgetMenuContent(
  tab: LayoutTab | undefined,
  result: WidgetResult | undefined,
): WidgetKindMenuContent | undefined {
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  const layoutId = useListOwnerLayoutId()
  const listId = tab ? tabListId(tab) : undefined
  const listName = useListDefinitionStore((s) =>
    listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined,
  )
  const neglectEntries = useNeglectMenuEntries(tab?.kind === 'neglect' ? tab : undefined)
  const listZoomEntries = useListZoomMenuEntries(tab?.kind === 'lens' ? tab : undefined)
  // A list tab's Review these N tasks (D26), above its zoom.
  const reviewEntries = useListReviewMenuEntries(tab?.kind === 'lens' ? tab : undefined)
  const zoomEntries: MenuEntry[] = [...reviewEntries, ...listZoomEntries]
  if (!tab) return undefined
  // A glance widget's settings and Copy (its lines, while it is the cell's active tab).
  const glance = glanceMenu(isGlanceTab(tab) ? tab : undefined, result?.summary)

  /**
   * Changes the tab's kind. Switched to List, it shows a new blank list of
   * the layout (no editor opens). An open editor holding changes (Edit list,
   * a widget editor — this tab's, maybe) is asked first, Save / Discard /
   * Keep editing (`editor-leave`): Keep editing changes nothing. A press
   * would have asked already; this is the keyboard's way here.
   */
  const changeKind = (kind: WidgetKind) => {
    if (kind === tab.kind) return
    afterLeavingEditors(() => {
      if (WIDGET_KIND_SPECS[kind].showsList) {
        if (layoutId == null) return
        void createListAndTab((id) => changeTabKind(tab.id, 'lens', { listDefinitionId: id }), layoutId)
        return
      }
      changeTabKind(tab.id, kind)
    })
  }

  const listActions = (): WidgetMenuAction[] | undefined => {
    if (tab.kind !== 'lens' || !result) return undefined
    return [
      {
        label: 'Copy tasks',
        icon: '⧉',
        onSelect: () => {
          const sections = result.sections
          const labelled = !(sections.length === 1 && sections[0]?.key === 'all')
          void copyTasks(sections.map((sec) => ({ label: labelled ? sec.label : undefined, todos: [...sec.todos] })))
        },
      },
      // A grouped list: fold or unfold every group (the collapse set is per tab, never saved).
      ...(result.grouped ? [
        {
          label: 'Collapse all groups',
          icon: <ChevronUpIcon />,
          onSelect: () => useListWidgetStore.getState().setCollapsed(tab.id, result.sections.map((sec) => sec.key)),
        },
        {
          label: 'Expand all groups',
          icon: <ChevronDownIcon size={14} />,
          onSelect: () => useListWidgetStore.getState().setCollapsed(tab.id, []),
        },
      ] : []),
    ]
  }

  return {
    currentKind: tab.kind,
    onChangeKind: changeKind,
    onEditList: listId != null && (tab.kind === 'lens' || listName != null)
      ? () => openEditList(tab.id, listId)
      : undefined,
    settingEntries: tab.kind === 'neglect' ? neglectEntries : tab.kind === 'lens' ? zoomEntries : glance?.settingEntries,
    widgetActions: glance ? glance.actions : tab.kind === 'lens' ? listActions() : undefined,
  }
}
