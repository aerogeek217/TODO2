import { useMemo, type ReactNode } from 'react'
import { WIDGET_KINDS, widgetKindLabel, type WidgetKind } from '../../models/workspace-layout'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { bySortOrder } from '../../utils/sort-order'
import { WidgetKindIcon } from './icons'
import { MenuPopover, type MenuEntry, type MenuItemEntry, type MenuPanelSpec } from './MenuPopover'

/** One choice of a {@link WidgetSetting}. */
export interface WidgetSettingOption {
  key: string
  label: string
  /** Muted trailing text (e.g. the cut-off date a range implies). */
  note?: string
  checked: boolean
  onSelect: () => void
}

/**
 * A widget setting listed first in the tab menu: an item with its current
 * value that opens a submenu of radio choices (e.g. the Eisenhower widget's
 * due-date range).
 */
export interface WidgetSetting {
  label: string
  /** The current value, right-aligned on the item. */
  value: string
  /** Group label at the top of the submenu. */
  heading: string
  options: readonly WidgetSettingOption[]
  /** Muted note under the choices. */
  footnote?: string
}

/**
 * A panel a widget action opens beside its item (e.g. the dashboard's
 * `Hot is ›`): controls rather than menu choices, so it's a small dialog —
 * changes apply as they're made and it stays open until Esc / ← / a click
 * outside the menu.
 */
export type WidgetMenuPanel = MenuPanelSpec

/** A widget action in the tab menu: runs and closes, or opens a {@link WidgetMenuPanel}. */
export type WidgetMenuAction =
  | { label: string; icon?: ReactNode; onSelect: () => void; note?: undefined; panel?: undefined }
  | { label: string; icon?: ReactNode; note?: string; panel: WidgetMenuPanel; onSelect?: undefined }

export interface WidgetKindMenuProps {
  anchor: { x: number; y: number }
  /** Current widget kind. Omit in "add" mode — no row is marked active and no secondary row is shown. */
  currentKind?: WidgetKind
  onChangeKind: (kind: WidgetKind) => void
  /**
   * Lens-only: fires when the user picks a list from the "Change list"
   * submenu (the saved lists in their order); a pick closes the menu.
   */
  pickListForLens?: (listDefinitionId: number) => void
  /**
   * "Edit list…" for the tab's list: a list tab's menu opens with the list's
   * own items — "Edit list…", then "Change list ›" (showing
   * `currentListName`) — then the widget actions, then "Change widget"; an
   * Eisenhower tab on a list (`listSource`) opens with "Edit list…" before
   * "Show ›". The caller binds the widget's list; the menu forwards the
   * click and closes.
   */
  onEditList?: () => void
  onClose: () => void
  /** Group-label heading. Defaults to "Change widget"; use "Add widget" in add mode. */
  heading?: string
  /**
   * The widget's own actions (e.g. "Copy tasks"), listed before the kind
   * switcher. Each closes the menu after running.
   */
  widgetActions?: ReadonlyArray<WidgetMenuAction>
  /** The list a list tab shows, as the note on "Change list ›". */
  currentListName?: string
  /** A setting of the widget, listed first (see {@link WidgetSetting}). */
  widgetSetting?: WidgetSetting
  /**
   * An Eisenhower tab: what it shows, as a `Show ›` submenu — All tasks,
   * then the saved lists (the list choices of a list tab's Change list) —
   * with Edit list… above it while a list is set (`onEditList`). A pick
   * closes the menu.
   */
  listSource?: ListSource
}

/** What a widget that can show a saved list shows (see `WidgetKindMenuProps.listSource`). */
export interface ListSource {
  /** The list shown; `undefined` = all tasks. */
  listDefinitionId: number | undefined
  /** The current choice in words, the note on `Show ›` (the list's name, `All tasks`). */
  note: string
  onPick: (listDefinitionId: number | undefined) => void
}

/** The `Show ›` choice that is no list. */
export const ALL_TASKS_LABEL = 'All tasks'

const CHANGE_LIST_WIDTH_PX = 240
const CHANGE_LIST_MAX_HEIGHT_PX = 320
const SETTING_SUBMENU_WIDTH_PX = 248

/**
 * A tab's menu (right-click or Shift+F10 / the Menu key on a tab) and the
 * add-tab menu, as a {@link MenuPopover} at the pointer: the widget's own
 * items first (a list's Edit list… / Change list ›, a
 * widget setting's radio submenu, widget actions — plain items or a panel
 * beside the item), then the kinds under "Change widget" (radio items, the
 * current one checked) or "Add widget".
 */
export function WidgetKindMenu({
  anchor,
  currentKind,
  onChangeKind,
  pickListForLens,
  onEditList,
  onClose,
  heading = 'Change widget',
  widgetActions,
  currentListName,
  widgetSetting,
  listSource,
}: WidgetKindMenuProps) {
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const showChangeList = currentKind === 'lens' && pickListForLens != null
  const listFirst = currentKind === 'lens' && onEditList != null

  const listChoices = useMemo<MenuEntry[]>(
    () => (pickListForLens ? listChoiceEntries(listDefinitions, (id) => { if (id != null) pickListForLens(id) }) : []),
    [listDefinitions, pickListForLens],
  )
  const sourceChoices = useMemo<MenuEntry[]>(
    () => (listSource ? listChoiceEntries(listDefinitions, listSource.onPick, { current: listSource.listDefinitionId }) : []),
    [listDefinitions, listSource],
  )

  const entries: MenuEntry[] = []
  const changeList: MenuItemEntry = {
    kind: 'item',
    label: listFirst ? 'Change list' : 'Change list…',
    note: listFirst ? currentListName : undefined,
    children: listChoices,
    childrenWidth: CHANGE_LIST_WIDTH_PX,
    childrenMaxHeight: CHANGE_LIST_MAX_HEIGHT_PX,
  }
  const actions: MenuItemEntry[] = (widgetActions ?? []).map((a) => (a.panel
    ? { kind: 'item', label: a.label, icon: listFirst ? undefined : a.icon, note: a.note, panel: a.panel }
    : { kind: 'item', label: a.label, icon: listFirst ? undefined : a.icon, onSelect: a.onSelect }))
  const kinds: MenuItemEntry[] = WIDGET_KINDS.map((k) => ({
    kind: 'item',
    label: widgetKindLabel(k),
    icon: <WidgetKindIcon kind={k} />,
    // Changing a widget: one of them is the current kind. Adding: plain actions.
    radio: currentKind != null,
    checked: currentKind != null ? k === currentKind : undefined,
    onSelect: () => onChangeKind(k),
  }))

  if (listFirst) {
    entries.push({ kind: 'item', label: 'Edit list…', onSelect: () => onEditList?.() })
    if (showChangeList) entries.push(changeList)
    entries.push({ kind: 'separator' })
    if (actions.length > 0) entries.push(...actions, { kind: 'separator' })
    entries.push({ kind: 'label', text: heading }, ...kinds)
  } else {
    if (listSource) {
      if (onEditList) entries.push({ kind: 'item', label: 'Edit list…', onSelect: () => onEditList() })
      entries.push({
        kind: 'item',
        label: 'Show',
        note: listSource.note,
        children: sourceChoices,
        childrenWidth: CHANGE_LIST_WIDTH_PX,
        childrenMaxHeight: CHANGE_LIST_MAX_HEIGHT_PX,
      })
      if (!widgetSetting) entries.push({ kind: 'separator' })
    }
    if (widgetSetting) {
      entries.push({
        kind: 'item',
        label: widgetSetting.label,
        note: widgetSetting.value,
        childrenWidth: SETTING_SUBMENU_WIDTH_PX,
        children: [
          { kind: 'label', text: widgetSetting.heading },
          ...widgetSetting.options.map((o): MenuEntry => ({
            kind: 'item',
            label: o.label,
            note: o.note,
            radio: true,
            indicator: 'radio',
            checked: o.checked,
            onSelect: o.onSelect,
          })),
          ...(widgetSetting.footnote ? [{ kind: 'separator' } as const, { kind: 'note', text: widgetSetting.footnote } as const] : []),
        ],
      }, { kind: 'separator' })
    }
    if (actions.length > 0) entries.push(...actions, { kind: 'separator' })
    entries.push({ kind: 'label', text: heading }, ...kinds)
    if (showChangeList) entries.push({ kind: 'separator' }, changeList)
  }

  return <MenuPopover point={anchor} entries={entries} label={heading} onClose={onClose} />
}

/**
 * The saved lists (in their order) as the entries of a list submenu —
 * a list tab's Change list ›, an Eisenhower tab's Show › — each picking its
 * list. `allTasks` puts an `All tasks` choice (`undefined`) first and makes
 * the choices radios, the `current` one checked.
 */
function listChoiceEntries(
  listDefinitions: readonly PersistedListDefinition[],
  onPick: (listDefinitionId: number | undefined) => void,
  allTasks?: { current: number | undefined },
): MenuEntry[] {
  const defs = [...listDefinitions].sort(bySortOrder)
  const choice = (label: string, id: number | undefined): MenuEntry => (allTasks
    ? { kind: 'item', label, radio: true, checked: id === allTasks.current, onSelect: () => onPick(id) }
    : { kind: 'item', label, onSelect: () => onPick(id) })
  const lists = defs.map((d) => choice(d.name, d.id))
  if (!allTasks) return lists.length > 0 ? lists : [{ kind: 'note', text: 'No lists yet.' }]
  return [
    choice(ALL_TASKS_LABEL, undefined),
    ...(lists.length > 0 ? [{ kind: 'separator' } as const, { kind: 'label', text: 'Saved lists' } as const, ...lists] : []),
  ]
}
