import { useMemo, type ReactNode } from 'react'
import { WIDGET_KIND_GROUPS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { listChoiceEntries } from './list-choice-entries'
import { WidgetKindIcon } from './icons'
import type { MenuEntry, MenuItemEntry } from './MenuPopover'

/**
 * The entries of a widget's menu — `WidgetKindMenu`'s, and the widget part
 * of a cell's ⋯ menu (D26 AA1, `workspace/cell-menu`) —, and what they are
 * built from.
 */

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

/** A widget action in the tab menu: runs and closes. With `checked`, a checkbox row (a switch of the widget's). */
export interface WidgetMenuAction {
  label: string
  icon?: ReactNode
  checked?: boolean
  onSelect: () => void
}

export interface WidgetKindMenuProps {
  anchor: { x: number; y: number }
  /** Current widget kind. Omit in "add" mode — no row is marked active and no secondary row is shown. */
  currentKind?: WidgetKind
  onChangeKind: (kind: WidgetKind) => void
  /** Kinds offered but not available now, each with why (shown under it, the item disabled). */
  unavailableKinds?: Partial<Record<WidgetKind, string>>
  /**
   * Lens-only: fires when the user picks a list from the "Change list"
   * submenu (the layout's lists in their order); a pick closes the menu.
   */
  pickListForLens?: (listDefinitionId: number) => void
  /**
   * "Edit list…" for the tab's list: a list tab's menu opens with the list's
   * own items — "Edit list…", then "Change list ›" (showing
   * `currentListName`) — then the widget actions, then "Change widget"; an Eisenhower tab has
   * "Edit list…" (its own list) first. The caller binds the widget's list;
   * the menu forwards the click and closes.
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
   * The widget's own setting items, as menu entries (submenus of their own,
   * e.g. a Neglect map's Colour by ›), listed first in a non-list tab's menu;
   * in a list tab's, after its list items (e.g. its Zoom − / +).
   */
  settingEntries?: readonly MenuEntry[]
  /**
   * Items listed first after a non-list tab's Edit list… (an Eisenhower
   * tab's: its own list), e.g. the Eisenhower's Customize panes…, before
   * the widget setting. Each closes the menu after running.
   */
  sourceActions?: ReadonlyArray<{ label: string; icon?: ReactNode; onSelect: () => void }>
  /**
   * The stored layout the tab is in: Change list offers the lists it owns
   * (`listChoiceEntries`). Omit: none.
   */
  listLayoutId?: number
  /** Entries before everything else (Add widget's where: Tab · Right · Below · Row · Column). */
  leadEntries?: readonly MenuEntry[]
  /**
   * Add mode: a kind's presets, as its item's submenu (Breakdown ›
   * People · Tags · Status · Waiting on · Custom, D26 P8); each runs and
   * closes the menu.
   */
  kindPresets?: Partial<Record<WidgetKind, readonly MenuItemEntry[]>>
}

const CHANGE_LIST_WIDTH_PX = 240
const CHANGE_LIST_MAX_HEIGHT_PX = 320
const SETTING_SUBMENU_WIDTH_PX = 248
const KIND_SUBMENU_WIDTH_PX = 240

/** What {@link widgetKindMenuEntries} builds the entries from: `WidgetKindMenu`'s props but where it opens and its close. */
export type WidgetKindMenuContent = Omit<WidgetKindMenuProps, 'anchor' | 'onClose'>

/** {@link widgetKindMenuEntries} over the stored lists (Change list's choices). */
export function useWidgetKindMenuEntries(content: WidgetKindMenuContent): MenuEntry[] {
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const { pickListForLens, listLayoutId } = content
  const listChoices = useMemo<MenuEntry[]>(
    () => (pickListForLens ? listChoiceEntries(listDefinitions, pickListForLens, listLayoutId) : []),
    [listDefinitions, pickListForLens, listLayoutId],
  )
  return widgetKindMenuEntries(content, listChoices)
}

/**
 * The entries of a widget's menu (`WidgetKindMenu`; the cell's ⋯ menu lists
 * them first, D26 AA1): its own items, then the kinds. `listChoices` are
 * Change list's items.
 */
export function widgetKindMenuEntries({
  currentKind,
  onChangeKind,
  unavailableKinds,
  pickListForLens,
  onEditList,
  heading = 'Change widget',
  widgetActions,
  currentListName,
  widgetSetting,
  settingEntries,
  sourceActions,
  leadEntries,
  kindPresets,
}: WidgetKindMenuContent, listChoices: readonly MenuEntry[]): MenuEntry[] {
  const showChangeList = currentKind === 'lens' && pickListForLens != null
  const listFirst = currentKind === 'lens' && onEditList != null

  const entries: MenuEntry[] = leadEntries && leadEntries.length > 0 ? [...leadEntries, { kind: 'separator' }] : []
  const changeList: MenuItemEntry = {
    kind: 'item',
    label: listFirst ? 'Change list' : 'Change list…',
    note: listFirst ? currentListName : undefined,
    children: listChoices,
    childrenWidth: CHANGE_LIST_WIDTH_PX,
    childrenMaxHeight: CHANGE_LIST_MAX_HEIGHT_PX,
  }
  const actions: MenuItemEntry[] = (widgetActions ?? []).map((a) => ({
    kind: 'item',
    label: a.label,
    icon: listFirst ? undefined : a.icon,
    ...(a.checked !== undefined ? { checkbox: true, checked: a.checked } : {}),
    onSelect: a.onSelect,
  }))
  const kindItem = (k: WidgetKind): MenuItemEntry => {
    // Add mode: a kind with presets opens them (D26 P8).
    const presets = currentKind == null ? kindPresets?.[k] : undefined
    if (presets && presets.length > 0) {
      return {
        kind: 'item',
        label: widgetKindLabel(k),
        icon: <WidgetKindIcon kind={k} />,
        childrenWidth: KIND_SUBMENU_WIDTH_PX,
        children: [{ kind: 'label', text: widgetKindLabel(k) }, ...presets],
      }
    }
    return plainKindItem(k)
  }
  const plainKindItem = (k: WidgetKind): MenuItemEntry => ({
    kind: 'item',
    label: widgetKindLabel(k),
    icon: <WidgetKindIcon kind={k} />,
    // Changing a widget: one of them is the current kind. Adding: plain actions.
    radio: currentKind != null,
    checked: currentKind != null ? k === currentKind : undefined,
    disabled: k !== currentKind && unavailableKinds?.[k] != null ? true : undefined,
    description: k !== currentKind ? unavailableKinds?.[k] : undefined,
    onSelect: () => onChangeKind(k),
  })
  // The kinds by group: the first (Tasks) inline — changing a widget, under
  // the menu's heading, which says what a pick does —, every other (Numbers &
  // charts) a submenu of its own.
  const kinds: MenuEntry[] = WIDGET_KIND_GROUPS.flatMap(({ group, label }, i): MenuEntry[] => {
    const items = widgetKindsOf(group).map(kindItem)
    if (i === 0) return [{ kind: 'label', text: currentKind != null ? heading : label }, ...items]
    const current = currentKind != null && widgetKindsOf(group).includes(currentKind) ? currentKind : undefined
    return [{ kind: 'separator' }, {
      kind: 'item',
      label,
      // The chart glyph (Created vs completed's): the item lines up with the kinds above it.
      icon: <WidgetKindIcon kind="trend" />,
      note: current ? widgetKindLabel(current) : undefined,
      childrenWidth: KIND_SUBMENU_WIDTH_PX,
      children: [{ kind: 'label', text: label }, ...items],
    }]
  })

  if (listFirst) {
    entries.push({ kind: 'item', label: 'Edit list…', onSelect: () => onEditList?.() })
    if (showChangeList) entries.push(changeList)
    entries.push({ kind: 'separator' })
    if (settingEntries && settingEntries.length > 0) entries.push(...settingEntries, { kind: 'separator' })
    if (actions.length > 0) entries.push(...actions, { kind: 'separator' })
    entries.push(...kinds)
  } else {
    if (onEditList || (sourceActions?.length ?? 0) > 0) {
      if (onEditList) entries.push({ kind: 'item', label: 'Edit list…', onSelect: () => onEditList() })
      for (const a of sourceActions ?? []) entries.push({ kind: 'item', label: a.label, icon: a.icon, onSelect: a.onSelect })
      if (!widgetSetting) entries.push({ kind: 'separator' })
    }
    if (settingEntries && settingEntries.length > 0) entries.push(...settingEntries, { kind: 'separator' })
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
    entries.push(...kinds)
    if (showChangeList) entries.push({ kind: 'separator' }, changeList)
  }

  return entries
}
