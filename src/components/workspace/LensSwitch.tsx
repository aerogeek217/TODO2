import { useQuietLensSwitch, useWidgetLensSwitch } from '../../hooks/use-widget-lens'
import type { LensSwitchTab } from '../../models/workspace-layout'
import { LensSwitch } from '../shared/LensSwitch'
import styles from './LensSwitch.module.css'

// The control itself lives in `shared` (the review deck has one too); the widgets' editors import it from here.
export { LensSwitch }

/**
 * A widget's lens switch (not a list's): the standard `LensSwitch`
 * (`components/shared`), shown while a lens applies and hides something
 * here (`hides`, the widget's own share of what it hides), or the widget
 * ignores it (`useWidgetLensSwitch`); its click writes the tab's view state.
 * In a desktop cell it is quiet (`useQuietLensSwitch`): following the lens,
 * it shows only on the cell's hover and focus.
 */
export function TabLensSwitch({ tab, hides, floating = false }: {
  tab: LensSwitchTab
  hides: number
  /** Over the top-right corner of what holds it (positioned): a widget with no header line of its own in a cell of several widgets. */
  floating?: boolean
}) {
  const { mark, toggle } = useWidgetLensSwitch(tab, hides)
  const quiet = useQuietLensSwitch()
  if (!mark) return null
  const button = <LensSwitch lens={mark} onToggle={toggle} quiet={quiet} />
  return floating ? <span className={styles.floating}>{button}</span> : button
}
