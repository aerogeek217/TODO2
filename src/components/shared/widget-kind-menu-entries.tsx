import type { ReactNode } from 'react'
import { WIDGET_KIND_GROUPS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../../models/workspace-layout'
import { ExpandIcon, WidgetKindIcon } from './icons'
import type { MenuEntry, MenuItemEntry } from './MenuPopover'

/**
 * The entries of a widget's menu — `WidgetKindMenu`'s, and the widget part
 * of a cell's ⋯ menu (D26 AA1, `workspace/cell-menu`) —, and what they are
 * built from.
 */

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
   * "Edit list…" for the tab's list, first under the widget's heading (a
   * list tab's). The caller binds the widget's list; the menu forwards the click and closes.
   */
  onEditList?: () => void
  /** Open larger: the widget in the widget popup, after its actions (before Name and icon…). */
  onOpenLarger?: () => void
  /** Name and icon… (items 11, 14), just before Change widget ›: the tab's name and icon popover. */
  onNameAndIcon?: () => void
  /** `false`: no Change widget › (the widget popup's menu, which holds only the widget's own entries). */
  kindSwitch?: boolean
  onClose: () => void
  /** Changing: the kind switcher's item (default "Change widget"). Adding: the menu's name ("Add widget"). */
  heading?: string
  /**
   * The widget's own actions (e.g. "Copy tasks"), listed before the kind
   * switcher. Each closes the menu after running.
   */
  widgetActions?: ReadonlyArray<WidgetMenuAction>
  /**
   * The widget's own setting items, as menu entries (submenus of their own,
   * e.g. a Neglect map's Colour by ›), listed first in a non-list tab's menu;
   * in a list tab's, after its list items (e.g. its Zoom − / +).
   */
  settingEntries?: readonly MenuEntry[]
  /** Entries before everything else (Add widget's where: Tab · Right · Below · Row · Column). */
  leadEntries?: readonly MenuEntry[]
  /**
   * Add mode: a kind's presets, as its item's submenu (Breakdown ›
   * People · Tags · Status · Waiting on · Custom, D26 P8); each runs and
   * closes the menu.
   */
  kindPresets?: Partial<Record<WidgetKind, readonly MenuItemEntry[]>>
}

const KIND_SUBMENU_WIDTH_PX = 240

/** The widget menu's item that opens a tab's name and icon (items 11, 14). */
export const NAME_AND_ICON_LABEL = 'Name and icon…'

/** The action that opens a widget in the widget popup: the menu item's and the controls slot button's name. */
export const OPEN_LARGER_LABEL = 'Open larger'

/** What {@link widgetKindMenuEntries} builds the entries from: `WidgetKindMenu`'s props but where it opens and its close. */
export type WidgetKindMenuContent = Omit<WidgetKindMenuProps, 'anchor' | 'onClose'>

/**
 * The entries of a widget's menu. Changing a widget (the cell's ⋯ menu
 * lists them first, D26 AA1): a heading naming the widget's kind, then its
 * own items — Edit list…, its settings, its actions, Open larger, Name and
 * icon… — and last **Change widget ›**
 * (the current kind beside it), whose submenu holds every kind by group
 * under its caption. Adding (`currentKind` absent, Add widget): the lead
 * entries, then the kinds — the first group (Tasks) inline under its
 * caption, every other (Insights) a submenu of its own.
 */
export function widgetKindMenuEntries({
  currentKind,
  onChangeKind,
  unavailableKinds,
  onEditList,
  onOpenLarger,
  onNameAndIcon,
  kindSwitch = true,
  heading = 'Change widget',
  widgetActions,
  settingEntries,
  leadEntries,
  kindPresets,
}: WidgetKindMenuContent): MenuEntry[] {
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
    return {
      kind: 'item',
      label: widgetKindLabel(k),
      icon: <WidgetKindIcon kind={k} />,
      // Changing a widget: one of them is the current kind. Adding: plain actions.
      radio: currentKind != null,
      checked: currentKind != null ? k === currentKind : undefined,
      disabled: k !== currentKind && unavailableKinds?.[k] != null ? true : undefined,
      description: k !== currentKind ? unavailableKinds?.[k] : undefined,
      onSelect: () => onChangeKind(k),
    }
  }

  if (currentKind == null) {
    // Add mode: the first group inline under its caption, every other a submenu.
    const kinds = WIDGET_KIND_GROUPS.flatMap(({ group, label }, i): MenuEntry[] => {
      const items = widgetKindsOf(group).map(kindItem)
      if (i === 0) return [{ kind: 'label', text: label }, ...items]
      return [{ kind: 'separator' }, {
        kind: 'item',
        label,
        // The chart glyph (Created vs completed's): the item lines up with the kinds above it.
        icon: <WidgetKindIcon kind="trend" />,
        childrenWidth: KIND_SUBMENU_WIDTH_PX,
        children: [{ kind: 'label', text: label }, ...items],
      }]
    })
    return leadEntries && leadEntries.length > 0 ? [...leadEntries, { kind: 'separator' }, ...kinds] : kinds
  }

  const entries: MenuEntry[] = [{ kind: 'label', text: widgetKindLabel(currentKind) }]
  if (onEditList) entries.push({ kind: 'item', label: 'Edit list…', onSelect: () => onEditList() })
  if (settingEntries && settingEntries.length > 0) entries.push(...settingEntries)
  for (const a of widgetActions ?? []) {
    entries.push({
      kind: 'item',
      label: a.label,
      icon: a.icon,
      ...(a.checked !== undefined ? { checkbox: true, checked: a.checked } : {}),
      onSelect: a.onSelect,
    })
  }
  if (onOpenLarger) entries.push({ kind: 'item', label: OPEN_LARGER_LABEL, icon: <ExpandIcon />, onSelect: () => onOpenLarger() })
  if (onNameAndIcon) entries.push({ kind: 'item', label: NAME_AND_ICON_LABEL, onSelect: () => onNameAndIcon() })
  if (!kindSwitch) return entries
  // Change widget ›: every kind, by group under its caption.
  entries.push({
    kind: 'item',
    label: heading,
    note: widgetKindLabel(currentKind),
    childrenWidth: KIND_SUBMENU_WIDTH_PX,
    children: WIDGET_KIND_GROUPS.flatMap(({ group, label }, i): MenuEntry[] => [
      ...(i > 0 ? [{ kind: 'separator' } as const] : []),
      { kind: 'label', text: label },
      ...widgetKindsOf(group).map(kindItem),
    ]),
  })
  return entries
}
