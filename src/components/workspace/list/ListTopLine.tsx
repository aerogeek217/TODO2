import { useMemo } from 'react'
import type { ListTab } from '../../../models/workspace-layout'
import { useTabBadges } from '../../../hooks/use-tab-badges'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { TopLineName, WidgetTopLine } from '../WidgetTopLine'
import { useTabTitle } from '../widget-hooks'
import styles from './ListFilterRow.module.css'

/**
 * A list's name on its top line, alone in its cell (D26 AA1): what its tab
 * would show — the name and the badge capsule.
 */
export function ListTopLineLead({ tab }: { tab: ListTab }) {
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
 * slim one with what its tab would show — the name, the badge and the
 * count (while the screen filter narrows it).
 */
export function ListNameLine({ tab, count }: { tab: ListTab; count?: string }) {
  return (
    <WidgetTopLine alone className={styles.nameLine} lead={<ListTopLineLead tab={tab} />} data-testid="list-name-line">
      {count != null && <span className={styles.count} data-testid="list-count">{count}</span>}
    </WidgetTopLine>
  )
}
