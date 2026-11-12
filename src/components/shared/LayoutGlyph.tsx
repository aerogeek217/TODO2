import { layoutIcon, type IconValue } from '../../models/icon'
import { hueColor } from '../../utils/layout-hue'
import { AppIcon } from './AppIcon'

/**
 * A layout's icon beside its name (the picker, the phone's switcher): its
 * picked icon, else the layout glyph (J1); nothing for No icon. In the
 * layout's hue (D19) when it has one, else the color around it — a line
 * icon and a muted emoji take it, a color emoji keeps its own colors
 * (decision 15).
 */
export function LayoutGlyph({ layout, size = 14 }: { layout: { hue?: string; icon?: IconValue }; size?: number }) {
  return <AppIcon icon={layoutIcon(layout)} size={size} color={layout.hue ? hueColor(layout.hue) : undefined} />
}
