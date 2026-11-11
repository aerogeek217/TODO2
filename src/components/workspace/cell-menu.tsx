import {
  isGlanceTab,
  isLensSwitchTab,
  tabIgnoresLens,
  tabListId,
  WIDGET_KIND_SPECS,
  type LayoutCell,
  type LayoutTab,
  type WidgetKind,
} from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useAppliedLens } from '../../stores/screen-filter'
import { setTabIgnoresLens } from '../../hooks/use-widget-lens'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { copyTasks } from '../../services/task-copy'
import type { MenuEntry } from '../shared/MenuPopover'
import type { WidgetKindMenuContent, WidgetMenuAction } from '../shared/widget-kind-menu-entries'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseCellIcon,
  CloseIcon,
  PlusIcon,
  SplitBelowIcon,
  SplitRightIcon,
} from '../shared/icons'
import { mergeNeighbour, type Side } from '../../utils/workspace-grid'
import { tabsCount } from './workspace-drag'
import type { WidgetResult } from './WidgetBody'
import { useUrgentRangeSetting } from './eisenhower/urgent-range-setting'
import { CUSTOMIZE_PANES_LABEL, openEisenhowerSettings } from './eisenhower/eisenhower-settings-link'
import { useNeglectMenuEntries } from './neglect/neglect-menu'
import { glanceMenu } from './glance/glance-menu'
import { useListZoomMenuEntries } from './list/zoom-menu'
import { useListReviewMenuEntries } from './list/review-menu'
import { createListThenEdit, openEditList, useListOwnerLayoutId } from './widget-hooks'

/**
 * A cell's ⋯ menu (D26 AA1): the widget's own entries first, under its
 * kind's heading — Edit list…, Zoom, Copy…, Change widget › —, then the
 * cell's under Cell, in the table's words (D26 board V): Add widget…, Split
 * cell ▸, Merge with ▸, Insert ▸, Collapse row; then Close tab, Close cell. One
 * menu, opened from the ⋯ (a widget's top line, or a tab strip's header),
 * a right-click on the top line or a tab, and Shift+F10 / the Menu key.
 */

/** Merge with ▸ Right / Below: why the item is off when the cell doesn't merge that way. */
export const NO_MERGE_REASON = 'Only cells that make a rectangle together merge'

/** Insert ▸: a full-width row or a full-height column at an edge of the layout. */
const INSERT_ITEMS: ReadonlyArray<{ label: string; edge: Side }> = [
  { label: 'Row at the top', edge: 'top' },
  { label: 'Row at the bottom', edge: 'bottom' },
  { label: 'Column at the left', edge: 'left' },
  { label: 'Column at the right', edge: 'right' },
]

/** The cell across `side` that cell `cellId` merges with into a rectangle (Merge with ▸), in the open layout. */
function mergeTarget(cellId: string, side: Side): string | undefined {
  const layout = useWorkspaceStore.getState().working
  return layout ? mergeNeighbour(layout, cellId, side)?.id : undefined
}

/** What the cell's own part of the menu acts on. */
export interface CellMenuActions {
  cell: Pick<LayoutCell, 'id' | 'tabs'>
  /** The tab Close tab closes (the menu's widget). */
  tab: LayoutTab | undefined
  /** Its title, for Close tab's words. */
  tabTitle: string
  /** Every row track it covers is collapsed: Expand row instead of Collapse row. */
  collapsed: boolean
  onAddWidget: () => void
  onSplit: (side: 'right' | 'bottom') => void
  onMerge: (otherCellId: string) => void
  onInsert: (edge: Side) => void
  onCollapse: (next: boolean) => void
  onCloseTab: (tabId: string) => void
  onCloseCell: () => void
  /** Look up the cell Merge with ▸ would take that way (default: in the open layout). */
  mergeWith?: (cellId: string, side: Side) => string | undefined
}

/**
 * The cell's part of the ⋯ menu, under its heading (Cell): Add widget…,
 * Split cell ▸, Merge with ▸, Insert ▸, Collapse row, then Close tab (with
 * two or more widgets; one widget's is Close cell's) and Close cell.
 */
export function cellMenuEntries(a: CellMenuActions): MenuEntry[] {
  const mergeWith = a.mergeWith ?? mergeTarget
  const several = a.cell.tabs.length > 1
  return [
    { kind: 'label', text: 'Cell' },
    {
      kind: 'item',
      label: 'Add widget…',
      icon: <PlusIcon />,
      submenu: true,
      onSelect: a.onAddWidget,
    },
    {
      kind: 'item',
      label: 'Split cell',
      icon: <SplitRightIcon />,
      children: [
        { kind: 'item', label: 'Right', icon: <SplitRightIcon />, onSelect: () => a.onSplit('right') },
        { kind: 'item', label: 'Below', icon: <SplitBelowIcon />, onSelect: () => a.onSplit('bottom') },
      ],
    },
    {
      kind: 'item',
      label: 'Merge with',
      children: (['right', 'bottom'] as const).map((side): MenuEntry => {
        const other = mergeWith(a.cell.id, side)
        return {
          kind: 'item',
          label: side === 'right' ? 'Right' : 'Below',
          disabled: other == null,
          title: other == null ? NO_MERGE_REASON : undefined,
          onSelect: () => { if (other) a.onMerge(other) },
        }
      }),
    },
    {
      kind: 'item',
      label: 'Insert',
      children: INSERT_ITEMS.map(({ label, edge }): MenuEntry => ({ kind: 'item', label, onSelect: () => a.onInsert(edge) })),
    },
    {
      kind: 'item',
      label: a.collapsed ? 'Expand row' : 'Collapse row',
      icon: a.collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon />,
      onSelect: () => a.onCollapse(!a.collapsed),
    },
    { kind: 'separator' },
    ...(several && a.tab ? [{
      kind: 'item' as const,
      label: `Close tab “${a.tabTitle}”`,
      icon: <CloseIcon size={14} strokeWidth={1.6} />,
      onSelect: () => { if (a.tab) a.onCloseTab(a.tab.id) },
    }] : []),
    {
      kind: 'item',
      label: several ? `Close cell (${tabsCount(a.cell.tabs.length)})` : 'Close cell',
      icon: <CloseCellIcon />,
      onSelect: a.onCloseCell,
    },
  ]
}

/** The merged ⋯ menu: the widget's entries, a separator, the cell's (no separator doubled or left at an end). */
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
 * The widget's menu switch for the top bar's lens (G3, board BD — its
 * header's lens switch in words): `Apply lens “X” here`, checked while it
 * applies; saved at once — a list's on its list, any other widget's in its
 * view state. Offered while a lens applies at the top bar, on every widget
 * the screen filter reaches.
 */
function useLensMenuAction(tab: LayoutTab | undefined, listId: number | undefined): WidgetMenuAction | undefined {
  const lens = useAppliedLens()
  const listIgnores = useListDefinitionStore((s) => listId != null && s.listDefinitions.find((d) => d.id === listId)?.ignoreLens === true)
  if (!lens || !tab) return undefined
  if (tab.kind === 'lens') {
    if (listId == null) return undefined
    return {
      label: `Apply lens “${lens.name}” here`,
      checked: !listIgnores,
      onSelect: () => void useListDefinitionStore.getState().setIgnoreLens(listId, !listIgnores),
    }
  }
  if (!isLensSwitchTab(tab) || (tab.kind === 'number' && tab.config.show === 'list')) return undefined
  const ignored = tabIgnoresLens(tab)
  return { label: `Apply lens “${lens.name}” here`, checked: !ignored, onSelect: () => setTabIgnoresLens(tab, !ignored) }
}

/**
 * The widget part of the ⋯ menu for `tab` (what its tab menu had): its
 * list's Edit list…, its settings, its actions (Copy, the
 * lens switch, Collapse / Expand all groups), then Change widget.
 * `result` is what the cell's active widget last reported (its Copy lines,
 * a list's sections); `undefined` content when there is no tab.
 */
export function useWidgetMenuContent(
  tab: LayoutTab | undefined,
  result: WidgetResult | undefined,
): WidgetKindMenuContent | undefined {
  const changeTabKind = useWorkspaceStore((s) => s.changeTabKind)
  const urgentRangeSetting = useUrgentRangeSetting()
  const layoutId = useListOwnerLayoutId()
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  const listId = tab ? tabListId(tab, eisenhowerListId) : undefined
  const listName = useListDefinitionStore((s) =>
    listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined,
  )
  const neglectEntries = useNeglectMenuEntries(tab?.kind === 'neglect' ? tab : undefined)
  const listZoomEntries = useListZoomMenuEntries(tab?.kind === 'lens' ? tab : undefined)
  // A list tab's Review these N tasks (D26), above its zoom.
  const reviewEntries = useListReviewMenuEntries(tab?.kind === 'lens' ? tab : undefined)
  const zoomEntries: MenuEntry[] = [...reviewEntries, ...listZoomEntries]
  const lensAction = useLensMenuAction(tab, tab?.kind === 'lens' ? tab.config.listDefinitionId : undefined)
  if (!tab) return undefined
  // A glance widget's settings and Copy (its lines, while it is the cell's active tab).
  const glance = glanceMenu(isGlanceTab(tab) ? tab : undefined, result?.summary)

  /**
   * Changes the tab's kind. Switched to List — an Eisenhower tab too: the
   * Eisenhower's own list is never a list tab's — it shows a new blank list
   * of the layout, whose Edit list opens at once.
   */
  const changeKind = (kind: WidgetKind) => {
    if (kind === tab.kind) return
    if (WIDGET_KIND_SPECS[kind].showsList) {
      if (layoutId == null) return
      void createListThenEdit((id) => {
        changeTabKind(tab.id, 'lens', { listDefinitionId: id })
        return tab.id
      }, layoutId)
      return
    }
    changeTabKind(tab.id, kind)
  }

  const listActions = (): WidgetMenuAction[] | undefined => {
    if (tab.kind !== 'lens' || !result) return undefined
    return [
      // The top bar's lens on this list, while one applies there: on / off here (saved at once).
      ...(lensAction ? [lensAction] : []),
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
    sourceActions: tab.kind === 'eisenhower'
      ? [{ label: CUSTOMIZE_PANES_LABEL, onSelect: () => openEisenhowerSettings() }]
      : undefined,
    widgetSetting: tab.kind === 'eisenhower' ? urgentRangeSetting : undefined,
    settingEntries: tab.kind === 'neglect' ? neglectEntries : tab.kind === 'lens' ? zoomEntries : glance?.settingEntries,
    widgetActions: glance
      ? [...(lensAction ? [lensAction] : []), ...glance.actions]
      : tab.kind === 'lens' ? listActions() : lensAction ? [lensAction] : undefined,
  }
}
