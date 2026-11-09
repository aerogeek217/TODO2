import { useMemo } from 'react'
import type { LensTab } from '../../../models/workspace-layout'
import { useIsListDirty } from '../../../hooks/use-list-draft'
import { useTabBadges } from '../../../hooks/use-tab-badges'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { GlassesIcon } from '../../shared/icons'
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

/** The lens on a list, in words: `“This month” hides 8 here` / `Ignores the lens “This month”`. */
function lensLine(lens: ListLensMark): string {
  return lens.ignored ? `Ignores the lens “${lens.name}”` : `“${lens.name}” hides ${lens.hides} here`
}

/**
 * A list whose filter line is hidden, alone in its cell: its top line is a
 * slim one with what its tab would show — the name, the unsaved dot, the
 * badge, the lens mark and the count.
 */
export function ListNameLine({ tab, listId, count, lens }: { tab: LensTab; listId: number; count: string; lens?: ListLensMark }) {
  return (
    <WidgetTopLine alone className={styles.nameLine} lead={<ListTopLineLead tab={tab} listId={listId} />} data-testid="list-name-line">
      {lens && (
        <span className={`${styles.lensMark} ${lens.ignored ? styles.lensMarkOff : ''}`} role="img" aria-label={lensLine(lens)} title={lensLine(lens)} data-testid="list-lens-mark">
          <GlassesIcon size={12} slashed={lens.ignored} />
        </span>
      )}
      <span className={styles.count} data-testid="list-count">{count}</span>
    </WidgetTopLine>
  )
}
