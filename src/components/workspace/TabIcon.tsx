import { tabStripIcon, type LayoutTab } from '../../models/workspace-layout'
import { AppIcon } from '../shared/AppIcon'

/**
 * A widget tab's icon wherever the tab is named — the strip, the `+N` menu,
 * the drag ghost, the widget popup (items 11, 14): its picked icon,
 * else its kind's glyph (J1); nothing (no wrapper either) for No icon.
 */
export function TabIcon({ tab, size = 12, className }: { tab: Pick<LayoutTab, 'kind' | 'icon'>; size?: number; className?: string }) {
  const icon = tabStripIcon(tab)
  if (icon.kind === 'none') return null
  return <span className={className} data-tab-icon="">{<AppIcon icon={icon} size={size} />}</span>
}
