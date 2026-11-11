import type { ReactNode } from 'react'
import { WIDGET_KIND_GROUPS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../../models/workspace-layout'
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
   * "Edit list…" for the tab's list, first under the widget's heading (a
   * list tab's; an Eisenhower tab's own list). The caller binds the
   * widget's list; the menu forwards the click and closes.
   */
  onEditList?: () => void
  onClose: () => void
  /** Changing: the kind switcher's item (default "Change widget"). Adding: the menu's name ("Add widget"). */
  heading?: string
  /**
   * The widget's own actions (e.g. "Copy tasks"), listed before the kind
   * switcher. Each closes the menu after running.
   */
  widgetActions?: ReadonlyArray<WidgetMenuAction>
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
  /** Entries before everything else (Add widget's where: Tab · Right · Below · Row · Column). */
  leadEntries?: readonly MenuEntry[]
  /**
   * Add mode: a kind's presets, as its item's submenu (Breakdown ›
   * People · Tags · Status · Waiting on · Custom, D26 P8); each runs and
   * closes the menu.
   */
  kindPresets?: Partial<Record<WidgetKind, readonly MenuItemEntry[]>>
}

const SETTING_SUBMENU_WIDTH_PX = 248
const KIND_SUBMENU_WIDTH_PX = 240

/** What {@link widgetKindMenuEntries} builds the entries from: `WidgetKindMenu`'s props but where it opens and its close. */
export type WidgetKindMenuContent = Omit<WidgetKindMenuProps, 'anchor' | 'onClose'>

/**
 * The entries of a widget's menu. Changing a widget (the cell's ⋯ menu
 * lists them first, D26 AA1): a heading naming the widget's kind, then its
 * own items — Edit list…, its source actions, its
 * settings, its widget setting, its actions — and last **Change widget ›**
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
  heading = 'Change widget',
  widgetActions,
  widgetSetting,
  settingEntries,
  sourceActions,
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
  for (const a of sourceActions ?? []) entries.push({ kind: 'item', label: a.label, icon: a.icon, onSelect: a.onSelect })
  if (settingEntries && settingEntries.length > 0) entries.push(...settingEntries)
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
    })
  }
  for (const a of widgetActions ?? []) {
    entries.push({
      kind: 'item',
      label: a.label,
      icon: a.icon,
      ...(a.checked !== undefined ? { checkbox: true, checked: a.checked } : {}),
      onSelect: a.onSelect,
    })
  }
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
