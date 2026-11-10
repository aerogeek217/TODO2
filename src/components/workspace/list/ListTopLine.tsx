import { useMemo } from 'react'
import type { LensTab } from '../../../models/workspace-layout'
import { useIsListDirty } from '../../../hooks/use-list-draft'
import { useTabBadges } from '../../../hooks/use-tab-badges'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { LensSwitch } from '../../shared/LensSwitch'
import { TopLineName, WidgetTopLine } from '../WidgetTopLine'
import { useTabTitle } from '../widget-hooks'
import type { ListLensMark } from './ListWidget'
import styles from './ListFilterRow.module.css'

/**
 * A list's name on its top line, alone in its cell (D26 AA1): what its tab
 * would show — the name, the unsaved dot and the badge capsule.
 */
export function ListTopLineLead({ tab, listId }: { tab: LensTab; listId: number }) {
  const title = useTabTitle(tab)
  const unsaved = useIsListDirty(listId)
  const tabs = useMemo(() => [tab], [tab])
  const badge = useTabBadges(tabs).get(tab.id)
  return (
    <>
      <TopLineName title={[title, ...(badge?.summary ?? [])].join('\n')}>{title}</TopLineName>
      {unsaved && <span className={styles.unsavedDot} role="img" aria-label="unsaved list changes" />}
      {badge && <BadgeCapsule counts={badge.counts} label={badge.summary.join(', ')} data-top-line-badge="" />}
    </>
  )
}

/**
 * A list whose filter line is hidden, alone in its cell: its top line is a
 * slim one with what its tab would show — the name, the unsaved dot, the
 * badge and the count — and, at its end, the lens switch (G3).
 */
export function ListNameLine({ tab, listId, count, lens, onToggleLens }: {
  tab: LensTab
  listId: number
  count: string
  lens?: ListLensMark
  onToggleLens?: () => void
}) {
  return (
    <WidgetTopLine alone className={styles.nameLine} lead={<ListTopLineLead tab={tab} listId={listId} />} data-testid="list-name-line">
      <span className={styles.count} data-testid="list-count">{count}</span>
      {lens && onToggleLens && <LensSwitch lens={lens} onToggle={onToggleLens} noun="list" />}
    </WidgetTopLine>
  )
}
