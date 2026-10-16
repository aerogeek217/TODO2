import { useMemo, type ReactNode } from 'react'
import type { WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { bySortOrder } from '../../utils/sort-order'
import { WidgetKindIcon } from './icons'
import { MenuPopover, type MenuEntry, type MenuItemEntry, type MenuPanelSpec } from './MenuPopover'

const PRIMARY_KINDS: { kind: WidgetKind; label: string }[] = [
  { kind: 'lens', label: 'List' },
  { kind: 'calendar', label: 'Calendar' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'eisenhower', label: 'Eisenhower' },
  { kind: 'dashboard', label: 'Dashboard' },
]

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
   * Lens-only: when provided alongside `currentKind === 'lens'`, renders an
   * "Edit list" action above the kind switcher. Caller binds the widget's
   * list-definition id; the menu just forwards the click and closes.
   */
  onEditList?: () => void
  onClose: () => void
  /** Optional label override for the secondary row (e.g. the current list-def name). */
  secondaryLabel?: string
  /** Group-label heading. Defaults to "Change widget"; use "Add widget" in add mode. */
  heading?: string
  /**
   * The widget's own actions (e.g. "Copy tasks"), listed before the kind
   * switcher. Each closes the menu after running.
   */
  widgetActions?: ReadonlyArray<WidgetMenuAction>
  /**
   * Lens-only, workspace order: when given, the menu opens with the list's
   * own items — "List options…", "Edit list…", "Change list ›" (showing
   * `currentListName`) — then the widget actions, then "Change widget".
   */
  onListOptions?: () => void
  currentListName?: string
  /** A setting of the widget, listed first (see {@link WidgetSetting}). */
  widgetSetting?: WidgetSetting
}

const CHANGE_LIST_WIDTH_PX = 240
const CHANGE_LIST_MAX_HEIGHT_PX = 320
const SETTING_SUBMENU_WIDTH_PX = 248

/**
 * A tab's menu (right-click or Shift+F10 / the Menu key on a tab) and the
 * add-tab menu, as a {@link MenuPopover} at the pointer: the widget's own
 * items first (a list's List options… / Edit list… / Change list ›, a
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
  secondaryLabel,
  heading = 'Change widget',
  widgetActions,
  onListOptions,
  currentListName,
  widgetSetting,
}: WidgetKindMenuProps) {
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const showChangeList = currentKind === 'lens' && pickListForLens != null
  const showEditList = currentKind === 'lens' && onEditList != null
  const listFirst = currentKind === 'lens' && onListOptions != null

  const listChoices = useMemo<MenuEntry[]>(() => {
    if (!pickListForLens) return []
    const defs = [...listDefinitions].sort(bySortOrder)
    if (defs.length === 0) return [{ kind: 'note', text: 'No lists yet.' }]
    return defs.map((d) => ({ kind: 'item', label: d.name, onSelect: () => pickListForLens(d.id as number) }))
  }, [listDefinitions, pickListForLens])

  const entries: MenuEntry[] = []
  const changeList: MenuItemEntry = {
    kind: 'item',
    label: listFirst ? 'Change list' : (secondaryLabel ?? 'Change list…'),
    note: listFirst ? currentListName : undefined,
    children: listChoices,
    childrenWidth: CHANGE_LIST_WIDTH_PX,
    childrenMaxHeight: CHANGE_LIST_MAX_HEIGHT_PX,
  }
  const editList: MenuItemEntry | null = showEditList && onEditList
    ? { kind: 'item', label: listFirst ? 'Edit list…' : 'Edit list', icon: listFirst ? undefined : '✎', onSelect: onEditList }
    : null
  const actions: MenuItemEntry[] = (widgetActions ?? []).map((a) => (a.panel
    ? { kind: 'item', label: a.label, icon: listFirst ? undefined : a.icon, note: a.note, panel: a.panel }
    : { kind: 'item', label: a.label, icon: listFirst ? undefined : a.icon, onSelect: a.onSelect }))
  const kinds: MenuItemEntry[] = PRIMARY_KINDS.map((k) => ({
    kind: 'item',
    label: k.label,
    icon: <WidgetKindIcon kind={k.kind} />,
    // Changing a widget: one of them is the current kind. Adding: plain actions.
    radio: currentKind != null,
    checked: currentKind != null ? k.kind === currentKind : undefined,
    onSelect: () => onChangeKind(k.kind),
  }))

  if (listFirst) {
    entries.push({ kind: 'item', label: 'List options…', onSelect: () => onListOptions?.() })
    if (editList) entries.push(editList)
    if (showChangeList) entries.push(changeList)
    entries.push({ kind: 'separator' })
    if (actions.length > 0) entries.push(...actions, { kind: 'separator' })
    entries.push({ kind: 'label', text: heading }, ...kinds)
  } else {
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
    if (editList) {
      entries.push(editList)
      if (actions.length === 0) entries.push({ kind: 'separator' })
    }
    if (actions.length > 0) entries.push(...actions, { kind: 'separator' })
    entries.push({ kind: 'label', text: heading }, ...kinds)
    if (showChangeList) entries.push({ kind: 'separator' }, changeList)
  }

  return <MenuPopover point={anchor} entries={entries} label={heading} onClose={onClose} />
}
