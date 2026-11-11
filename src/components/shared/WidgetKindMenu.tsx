import { MenuPopover } from './MenuPopover'
import { widgetKindMenuEntries, type WidgetKindMenuProps } from './widget-kind-menu-entries'

export type {
  WidgetKindMenuContent,
  WidgetKindMenuProps,
  WidgetMenuAction,
  WidgetSetting,
  WidgetSettingOption,
} from './widget-kind-menu-entries'

/**
 * A tab's menu (right-click or Shift+F10 / the Menu key on a tab) and the
 * add-tab menu, as a {@link MenuPopover} at the pointer: the widget's own
 * items first (a list's Edit list…, a widget setting's radio submenu,
 * widget actions), then the kinds under "Change widget" (radio items, the
 * current one checked) or "Add widget": the task kinds inline, the insights
 * in their own submenu (`Insights ›`, the current one's
 * name as its note), so the menu fits a short window under a tab.
 */
export function WidgetKindMenu({ anchor, onClose, heading = 'Change widget', ...content }: WidgetKindMenuProps) {
  const entries = widgetKindMenuEntries({ ...content, heading })
  return <MenuPopover point={anchor} entries={entries} label={heading} onClose={onClose} />
}
