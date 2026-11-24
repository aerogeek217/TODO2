import { useMemo } from 'react'
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
import { useUIStore } from '../../stores/ui-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { copyTasks } from '../../services/task-copy'
import type { MenuEntry, MenuItemEntry } from '../shared/MenuPopover'
import type { WidgetKindMenuContent, WidgetMenuAction } from '../shared/widget-kind-menu-entries'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CloseCellIcon,
  CloseIcon,
  CopyIcon,
  LayoutIcon,
  PencilIcon,
  PlusIcon,
  SplitBelowIcon,
  SplitRightIcon,
  UnfoldIcon,
  WidgetKindIcon,
} from '../shared/icons'
import type { Side } from '../../utils/workspace-grid'
import type { IconValue } from '../../models/icon'
import { LayoutGlyph } from '../shared/LayoutGlyph'
import { isNumberStripCell } from '../../utils/workspace-rows'
import { tabsCount } from './workspace-drag'
import type { WidgetResult } from './WidgetBody'
import { useNeglectMenuEntries } from './neglect/neglect-menu'
import { usePlannerMenuEntries } from './planner/planner-reset'
import { useShortcutsMenuEntries } from './shortcuts/shortcuts-menu'
import { glanceMenu } from './glance/glance-menu'
import { useListZoomMenuEntries } from './list/zoom-menu'
import { useListReviewMenuEntries } from './list/review-menu'
import { createListAndTab, openEditList, useListOwnerLayoutId } from './widget-hooks'

/**
 * A cell's menus (D26 AA1, UX cleanup 4A; layout edit mode E3, E4). The
 * rule: **edit mode changes the grid; what's inside a cell changes in
 * place.** Outside the mode the ⋯ (**Cell options**) — and a right-click on
 * a widget's top line or a tab, or Shift+F10 / the Menu key there — is this
 * widget and its cell's contents: the widget's own entries under its kind's
 * heading (Edit list…, Zoom, Copy…, Open larger, Name and icon…, Change
 * widget ›), then **Add widget as tab ›** (every kind, under Tasks and
 * Insights), **Remove widget** (a lone widget's cell stays, empty) — in a
 * cell showing a tab strip **Add tab ›** and **Remove tab** —,
 * Collapse / Expand row and column, and last **Edit layout**, which opens the layout
 * edit mode with this cell selected. Inside the mode a cell is a card, and
 * its menu (the card's ⋯, a right-click on the card, Enter on it: **Cell
 * layout**, `editCardMenuEntries`) places it: Move to ▸, Swap with ▸,
 * Join as tabs ▸, Split ▸, Merge with ▸, Stretch right / down, Remove
 * widget (Remove tab), Close cell.
 */

/**
 * Whether the cell shows its widgets as a tab strip: two or more tabs, not
 * a Numbers strip (whose Numbers stand side by side, not as tabs). There
 * the menus speak of tabs — Add tab ›, Remove tab —; elsewhere of a widget.
 */
function showsTabStrip(cell: Pick<LayoutCell, 'tabs'>): boolean {
  return cell.tabs.length > 1 && !isNumberStripCell(cell)
}

/** Remove widget, or Remove tab in a cell that shows a tab strip (`showsTabStrip`). */
function removeTabLabel(cell: Pick<LayoutCell, 'tabs'>): string {
  return showsTabStrip(cell) ? 'Remove tab' : 'Remove widget'
}

/** Add widget as tab ›, or Add tab › in a cell that shows a tab strip. */
function addTabLabel(cell: Pick<LayoutCell, 'tabs'>): string {
  return showsTabStrip(cell) ? 'Add tab' : 'Add widget as tab'
}

/** Merge with ▸ a side: why the item is off when the cell doesn't merge that way. */
export const NO_MERGE_REASON = 'Only cells that make a rectangle together merge'

/** Split ▸ and Merge with ▸: the four sides, in reading order. */
const SIDE_ITEMS: ReadonlyArray<{ label: string; side: Side }> = [
  { label: 'Above', side: 'top' },
  { label: 'Left', side: 'left' },
  { label: 'Right', side: 'right' },
  { label: 'Below', side: 'bottom' },
]

/** Insert ▸'s full tracks: a row on the card's top / bottom line, a column on its left / right one. */
const TRACK_ITEMS: ReadonlyArray<{ label: string; side: Side }> = [
  { label: 'Row above', side: 'top' },
  { label: 'Row below', side: 'bottom' },
  { label: 'Column left', side: 'left' },
  { label: 'Column right', side: 'right' },
]

/** What the cell's own part of the ⋯ menu acts on (outside the mode). */
export interface CellMenuActions {
  cell: Pick<LayoutCell, 'id' | 'tabs'>
  /** The tab Remove widget removes (the menu's widget). */
  tab: LayoutTab | undefined
  /** Its title. */
  tabTitle: string
  /** Every row track it covers is collapsed: Expand row instead of Collapse row. */
  collapsed: boolean
  onCollapse: (next: boolean) => void
  /** Some column track it covers is collapsed: Expand column instead of Collapse column. */
  columnCollapsed?: boolean
  /** Collapse / Expand column: every column track it covers. Absent: no entry. */
  onCollapseColumn?: (next: boolean) => void
  onCloseTab: (tabId: string) => void
  /** Add widget as tab › a kind (a Breakdown with its preset): a new tab of this cell, made its active one. */
  onAddTab: (kind: WidgetKind, preset?: BreakdownPreset) => void
  /** Edit layout (the ⋯'s last entry): opens the layout edit mode with this cell selected. Absent: no entry. */
  onEditLayout?: () => void
  /** Move to layout › / Copy to layout › (this widget). Absent: no entries. */
  transfer?: TransferMenu
}

/** A layout Move / Copy to layout › lists. */
interface TransferLayout {
  id: number
  name: string
  hue?: string
  icon?: IconValue
  /** The open layout: listed, off. */
  current: boolean
}

/** Move / Copy to layout ›'s layouts and its pick (`'new'`: New layout…, which asks the new layout's name). */
interface TransferMenu {
  layouts: readonly TransferLayout[]
  onPick: (to: number | 'new', copy: boolean) => void
}

/**
 * Move / Copy to layout ›'s menu for a widget (`kind` `tab`) or a whole cell
 * of the open layout (`id`): every layout, the open one off; a pick carries
 * it there (`workspace-store.transferTo`), New layout… asking the new
 * layout's name first (`ui-store.requestLayout`). None while widgets from
 * another layout are in hand, or without an id.
 */
export function useTransferMenu(kind: 'tab' | 'cell', id: string | undefined): TransferMenu | undefined {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const carrying = useWorkspaceStore((s) => s.editing?.incoming != null)
  return useMemo(() => {
    if (id == null || carrying) return undefined
    const what = kind === 'tab' ? { kind: 'tab' as const, tabId: id } : { kind: 'cell' as const, cellId: id }
    return {
      layouts: layouts.map((l) => ({
        id: l.id,
        name: l.name,
        ...(l.hue ? { hue: l.hue } : {}),
        ...(l.icon ? { icon: l.icon } : {}),
        current: l.id === activeLayoutId,
      })),
      onPick: (to, copy) => {
        if (to === 'new') useUIStore.getState().requestLayout({ kind: 'new', transfer: { what, copy } })
        else void useWorkspaceStore.getState().transferTo(to, what, copy)
      },
    }
  }, [kind, id, carrying, layouts, activeLayoutId])
}

/** The width of Move / Copy to layout ›'s submenu. */
const TRANSFER_SUBMENU_WIDTH_PX = 220

/**
 * Move to layout › and Copy to layout › (`label`s: the ⋯'s for a widget,
 * the card menu's for a whole cell): each the layouts — the open one off,
 * `this layout` beside it — then New layout….
 */
function transferEntries(t: TransferMenu | undefined, labels: { move: string; copy: string }): MenuEntry[] {
  if (!t) return []
  const entry = (copy: boolean): MenuEntry => ({
    kind: 'item',
    label: copy ? labels.copy : labels.move,
    icon: copy ? <CopyIcon /> : <LayoutIcon />,
    childrenWidth: TRANSFER_SUBMENU_WIDTH_PX,
    children: [
      ...t.layouts.map((l): MenuEntry => ({
        kind: 'item',
        label: l.name,
        icon: <LayoutGlyph layout={l} />,
        disabled: l.current,
        ...(l.current ? { note: 'this layout' } : {}),
        onSelect: () => t.onPick(l.id, copy),
      })),
      { kind: 'separator' },
      { kind: 'item', label: 'New layout…', icon: <PlusIcon />, onSelect: () => t.onPick('new', copy) },
    ],
  })
  return [entry(false), entry(true)]
}

/** The card menu's name (its `aria-label`; the card's ⋯ is named so too). */
export const EDIT_CARD_MENU_LABEL = 'Cell layout'

/** A place a card's menu offers: a slot to move to, a card to swap with — its cell id and its words. */
interface EditCardPlace {
  cellId: string
  /** What it is called: a slot's ruler name (`B4`), a card's widget name. */
  label: string
  /** Beside it: a card's ruler name. */
  note?: string
}

/** What a card's menu in the layout edit mode acts on (`editCardMenuEntries`). */
export interface EditCardMenuActions {
  /** The card's cell. */
  cell: Pick<LayoutCell, 'id' | 'tabs'>
  /** The tab Remove widget removes (the card's active one, or a strip's Number the menu came from). */
  tab: LayoutTab | undefined
  /** Every slot (empty cell), by ruler name: Move to ▸. */
  slots: readonly EditCardPlace[]
  /** Every other card, by name (`layout-edit-cards.cardName`): Swap with ▸, Join as tabs ▸. */
  cards: readonly EditCardPlace[]
  /** The cell Merge with ▸ would take on `side`, if they make a rectangle. */
  mergeWith: (side: Side) => string | undefined
  /** Whether Stretch right / down can go one track (an empty slot all along that side). */
  canStretch: (direction: 'right' | 'down') => boolean
  onMoveTo: (slotId: string) => void
  onSwap: (cellId: string) => void
  /** Join as tabs ▸ a card: this card's tabs join it (after its own). */
  onJoin: (cellId: string) => void
  onSplit: (side: Side) => void
  /** Insert ▸ a full row / column on the card's edge line on `side` (`workspace-store.insertTrackBeside`). */
  onInsertTrack: (side: Side) => void
  onMerge: (otherCellId: string) => void
  onStretch: (direction: 'right' | 'down') => void
  onRemoveWidget: (tabId: string) => void
  onCloseCell: () => void
  /** Move cell to layout › / Copy cell to layout › (the whole cell). Absent: no entries. */
  transfer?: TransferMenu
}

/**
 * A card's menu in the layout edit mode (E3, **Cell layout**): Move to ▸
 * (every slot by its ruler name), Swap with ▸ (every other card by name,
 * the whole cell), Join as tabs ▸ (the same cards: this card's tabs join
 * it — the keys' way to what a drop on a tab area does),
 * Insert ▸ (a full row above / below or column left / right on the card's
 * edge, as the rulers' menus insert — a card is where one looks for it —
 * then Split this cell: a new cell on a side, taking half of this one),
 * Merge with ▸ (each side its own entry; Merge off, saying why,
 * where the two make no rectangle), Stretch right / Stretch down (one
 * track, over empty slots only), then Remove widget (its cell stays, a
 * slot) and Close cell (the absorb rule).
 */
export function editCardMenuEntries(a: EditCardMenuActions): MenuEntry[] {
  const place = (p: EditCardPlace, run: (id: string) => void): MenuEntry => ({
    kind: 'item',
    label: p.label,
    ...(p.note ? { note: p.note } : {}),
    onSelect: () => run(p.cellId),
  })
  const several = a.cell.tabs.length > 1
  const tab = a.tab
  const stretch = (direction: 'right' | 'down'): MenuEntry => {
    const can = a.canStretch(direction)
    return {
      kind: 'item',
      label: direction === 'right' ? 'Stretch right' : 'Stretch down',
      icon: direction === 'right' ? <SplitRightIcon /> : <SplitBelowIcon />,
      disabled: !can,
      ...(can ? {} : { title: direction === 'right' ? 'Only over an empty slot all along its right side' : 'Only over an empty slot all along its bottom' }),
      onSelect: () => a.onStretch(direction),
    }
  }
  const entries: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Move to',
      disabled: a.slots.length === 0,
      ...(a.slots.length === 0 ? { title: 'No empty slot: insert a row or column first' } : {}),
      children: a.slots.map((p) => place(p, a.onMoveTo)),
    },
    {
      kind: 'item',
      label: 'Swap with',
      disabled: a.cards.length === 0,
      ...(a.cards.length === 0 ? { title: 'No other card' } : {}),
      children: a.cards.map((p) => place(p, a.onSwap)),
    },
    {
      kind: 'item',
      label: 'Join as tabs',
      disabled: a.cards.length === 0,
      ...(a.cards.length === 0 ? { title: 'No other card' } : {}),
      children: a.cards.map((p) => place(p, a.onJoin)),
    },
    {
      kind: 'item',
      label: 'Insert',
      icon: <PlusIcon />,
      childrenWidth: 220,
      children: [
        ...TRACK_ITEMS.map(({ label, side }): MenuEntry => ({ kind: 'item', label, onSelect: () => a.onInsertTrack(side) })),
        { kind: 'separator' },
        { kind: 'label', text: 'Split this cell' },
        ...SIDE_ITEMS.map(({ label, side }): MenuEntry => ({ kind: 'item', label: `New cell ${label.toLowerCase()}`, onSelect: () => a.onSplit(side) })),
      ],
    },
    {
      kind: 'item',
      label: 'Merge with',
      children: SIDE_ITEMS.map(({ label, side }): MenuEntry => {
        const other = a.mergeWith(side)
        return {
          kind: 'item',
          label,
          disabled: other == null,
          title: other == null ? NO_MERGE_REASON : undefined,
          onSelect: () => { if (other) a.onMerge(other) },
        }
      }),
    },
    stretch('right'),
    stretch('down'),
    { kind: 'separator' },
  ]
  const transfer = transferEntries(a.transfer, { move: 'Move cell to layout', copy: 'Copy cell to layout' })
  if (transfer.length > 0) entries.push(...transfer, { kind: 'separator' })
  if (tab) entries.push({ kind: 'item', label: removeTabLabel(a.cell), icon: <CloseIcon size={14} strokeWidth={1.6} />, onSelect: () => a.onRemoveWidget(tab.id) })
  entries.push({
    kind: 'item',
    label: several ? `Close cell (${tabsCount(a.cell.tabs.length)})` : 'Close cell',
    icon: <CloseCellIcon />,
    onSelect: a.onCloseCell,
  })
  return entries
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
    label: addTabLabel(a.cell),
    icon: <PlusIcon />,
    childrenWidth: ADD_TAB_SUBMENU_WIDTH_PX,
    children: WIDGET_KIND_GROUPS.flatMap(({ group, label }, i): MenuEntry[] => [
      ...(i > 0 ? [{ kind: 'separator' } as const] : []),
      { kind: 'label', text: label },
      ...widgetKindsOf(group).map(kindItem),
    ]),
  }
}

/** Collapse / Expand row, then Collapse / Expand column (outside the mode, in the ⋯: view state). */
function collapseEntries(a: CellMenuActions): MenuEntry[] {
  const row: MenuEntry = {
    kind: 'item',
    label: a.collapsed ? 'Expand row' : 'Collapse row',
    icon: a.collapsed ? <UnfoldIcon axis="rows" /> : <ChevronUpIcon />,
    onSelect: () => a.onCollapse(!a.collapsed),
  }
  const onColumn = a.onCollapseColumn
  if (!onColumn) return [row]
  const folded = a.columnCollapsed === true
  return [row, {
    kind: 'item',
    label: folded ? 'Expand column' : 'Collapse column',
    icon: folded ? <UnfoldIcon axis="columns" /> : <ChevronLeftIcon size={14} />,
    onSelect: () => onColumn(!folded),
  }]
}

/** Remove widget (outside the mode): removes this widget's tab — a lone widget's cell stays, empty (`workspace-store.removeWidget`). */
function removeWidgetEntry(a: CellMenuActions): MenuEntry[] {
  const tab = a.tab
  if (!tab) return []
  return [{ kind: 'item', label: removeTabLabel(a.cell), icon: <CloseIcon size={14} strokeWidth={1.6} />, onSelect: () => a.onCloseTab(tab.id) }]
}

/** Edit layout (the ⋯'s last entry): the layout edit mode, this cell selected. */
function editLayoutEntry(a: CellMenuActions): MenuEntry[] {
  const open = a.onEditLayout
  return open ? [{ kind: 'item', label: 'Edit layout', icon: <PencilIcon />, onSelect: open }] : []
}

/**
 * Which of a cell's menus is open outside the layout edit mode: the ⋯'s
 * (`widget`) or the whole menu (`all`: a right-click, Shift+F10 / the Menu
 * key) — the same menu. (In the mode a card has one menu, Cell layout.)
 */
export type CellMenuPart = 'widget' | 'all'

/** Each menu's name (its `aria-label`; the ⋯'s is its button's too). */
export const CELL_MENU_LABEL: Readonly<Record<CellMenuPart, string>> = {
  widget: 'Cell options',
  all: 'Cell options',
}

/**
 * The entries of the cell's ⋯ menu (outside the layout edit mode): the
 * widget's entries, then Add widget as tab ›, Remove widget, Collapse /
 * Expand row and column, then Edit layout.
 */
export function cellMenuFor(widget: readonly MenuEntry[], a: CellMenuActions): MenuEntry[] {
  const moved = mergedCellMenu(widget, transferEntries(a.transfer, { move: 'Move to layout', copy: 'Copy to layout' }))
  const own = mergedCellMenu(moved, [addTabEntry(a), ...removeWidgetEntry(a), ...collapseEntries(a)])
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
  // A Planner's Reset plan › (its top line's control, for a cell of tabs and the widget popup too).
  const plannerEntries = usePlannerMenuEntries(tab?.kind === 'planner' ? tab : undefined)
  // Shortcuts' Add a list ›.
  const shortcutsEntries = useShortcutsMenuEntries(tab?.kind === 'shortcuts' ? tab : undefined)
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
    settingEntries: tab.kind === 'neglect' ? neglectEntries
      : tab.kind === 'planner' ? plannerEntries
        : tab.kind === 'shortcuts' ? shortcutsEntries
          : tab.kind === 'lens' ? zoomEntries : glance?.settingEntries,
    widgetActions: glance ? glance.actions : tab.kind === 'lens' ? listActions() : undefined,
  }
}
