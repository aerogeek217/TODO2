import { useMemo } from 'react'
import type { LensTab } from '../../../models/workspace-layout'
import { useQuietLensSwitch } from '../../../hooks/use-widget-lens'
import { useTabBadges } from '../../../hooks/use-tab-badges'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { LensSwitch } from '../../shared/LensSwitch'
import { TopLineName, WidgetTopLine } from '../WidgetTopLine'
import { useTabTitle } from '../widget-hooks'
import type { ListLensMark } from './ListWidget'
import styles from './ListFilterRow.module.css'

/**
 * A list's name on its top line, alone in its cell (D26 AA1): what its tab
 * would show — the name and the badge capsule.
 */
export function ListTopLineLead({ tab }: { tab: LensTab }) {
  const title = useTabTitle(tab)
  const tabs = useMemo(() => [tab], [tab])
  const badge = useTabBadges(tabs).get(tab.id)
  return (
    <>
      <TopLineName title={[title, ...(badge?.summary ?? [])].join('\n')}>{title}</TopLineName>
      {badge && <BadgeCapsule counts={badge.counts} label={badge.summary.join(', ')} data-top-line-badge="" />}
    </>
  )
}

/**
 * A list whose filter line is hidden, alone in its cell: its top line is a
 * slim one with what its tab would show — the name, the
 * badge and the count (while the screen filter or the lens narrows it) —
 * and, at its end, the lens switch (G3; quiet on desktop).
 */
export function ListNameLine({ tab, count, lens, onToggleLens }: {
  tab: LensTab
  count?: string
  lens?: ListLensMark
  onToggleLens?: () => void
}) {
  const quietLens = useQuietLensSwitch()
  return (
    <WidgetTopLine alone className={styles.nameLine} lead={<ListTopLineLead tab={tab} />} data-testid="list-name-line">
      {count != null && <span className={styles.count} data-testid="list-count">{count}</span>}
      {lens && onToggleLens && <LensSwitch lens={lens} onToggle={onToggleLens} noun="list" quiet={quietLens} />}
    </WidgetTopLine>
  )
}
