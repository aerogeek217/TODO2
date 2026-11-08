import { useMemo } from 'react'
import type { TagsTab } from '../../../models/workspace-layout'
import { useStatsBase, useTagStats, type ShownOfTotal } from '../../../hooks/use-glance-data'
import { tagSectionDialog, tagsSectionDialog } from '../../../services/task-dialog'
import type { TagStats } from '../../../services/stats/tags'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { countOf } from './glance-copy'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { tagsLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { inSortOrder, priorityWords, type TodoLookup } from './section-data'
import { SECTION_META } from './section-meta'
import { Count, Empty, Panel, PriorityBadges, type SectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Tags reads. */
export interface TagsSectionData extends TodoLookup {
  tags: ShownOfTotal<TagStats>
}

/** Tags: each tag's open tasks, by priority and follow-ups due; No tag last (an option). */
export function TagsSection({ data, options, onDrill, style, className }: SectionProps<TagsSectionData>) {
  const { shown, total } = data.tags
  const showUntagged = options.showUntagged !== false && shown.untagged.ids.length > 0
  const all = useMemo(() => {
    const totalOpen = new Map(total.rows.map((r) => [r.tag.id, r.ids.length]))
    return [
      ...shown.rows.map((r) => ({ key: String(r.tag.id), tag: r.tag, stats: r, totalOpen: totalOpen.get(r.tag.id) ?? r.ids.length })),
      ...(showUntagged ? [{ key: 'none', tag: null, stats: shown.untagged, totalOpen: total.untagged.ids.length }] : []),
    ]
  }, [shown, total, showUntagged])
  const max = Math.max(1, ...all.map((r) => r.stats.ids.length))
  return (
    <Panel
      def={SECTION_META.tags}
      style={style}
      className={`${styles.tagsPanel}${className ? ` ${className}` : ''}`}
      count={`${countOf(shown.taggedIds.length, total.taggedIds.length)} tagged`}
      // Each tag's tasks in their own order, as a person's are.
      onCount={onDrill ? () => onDrill(tagsSectionDialog(shown.rows.map((r) => ({ tag: r.tag, todoIds: inSortOrder(r.ids, data) })))) : undefined}
      sub="Open tasks by tag"
    >
      {all.length === 0 ? (
        <Empty title="No tagged tasks" hint="Open tasks show here by tag." />
      ) : (
        <>
          <div className={`${styles.tagsGrid} ${styles.peopleHead}`}>
            <span>Tag</span><span>Open</span><span className={styles.tagsBarCol} /><span className={styles.num}>Priority</span><span className={styles.num}>Follow-up</span>
          </div>
          <div ref={trackScrollEdges} className={styles.panelBody}>
            {all.map(({ key, tag, stats, totalOpen }) => {
              const name = tag ? `#${tag.name}` : 'No tag'
              const open = stats.ids.length
              const openLabel = countOf(open, totalOpen)
              const content = (
                <>
                  <span className={styles.personName}>
                    <i className={`${styles.tagDot} ${tag ? '' : styles.avatarNone}`} style={tag ? { background: tag.color } : undefined} />
                    <span className={styles.tagName}>{name}</span>
                  </span>
                  <span className={`${styles.peopleBar} ${styles.tagsBarCol}`}><span style={{ width: `${Math.round((open / max) * 100)}%` }} /></span>
                  <span className={styles.num} data-testid="dash-tag-open">{openLabel}</span>
                  <PriorityBadges counts={stats.priority} />
                  <Count n={stats.followupDueIds.length} color="var(--color-followup)" />
                </>
              )
              const cls = `${styles.tagsGrid} ${styles.personRow}`
              return onDrill ? (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  data-tag-row={key}
                  aria-label={`${name}: ${openLabel} open, ${priorityWords(stats.priority)}${stats.followupDueIds.length} follow-up due`}
                  onClick={() => onDrill(tagSectionDialog(tag, inSortOrder(stats.ids, data)))}
                >
                  {content}
                </button>
              ) : (
                <div key={key} className={cls} data-tag-row={key}>{content}</div>
              )
            })}
          </div>
        </>
      )}
    </Panel>
  )
}

/** The Tags widget: the section filling its cell. */
export function TagsWidget({ tab, onResult, onDrill }: GlanceWidgetProps<TagsTab>) {
  const { showUntagged } = tab.config
  const base = useStatsBase()
  const tags = useTagStats(base)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => tagsLines({ tags }, showUntagged), [tags, showUntagged])
  useReportLines(onResult, lines)
  const top = tags.shown.rows.at(0)
  // No tag on any task: No tag's, when the widget shows it.
  const untagged = tags.shown.untagged.ids.length
  const topName = top ? `#${top.tag.name}` : showUntagged && untagged > 0 ? 'No tag' : undefined
  const topCount = top ? top.ids.length : topName ? untagged : 0
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.tags.glyph}
          glyphColor={SECTION_META.tags.glyphColor}
          title={SECTION_META.tags.title}
          entry={topName}
          value={String(topCount)}
          caption="open"
        />
      ) : <TagsSection
        data={{ tags, todoById: base.todoById }}
        options={{ showUntagged }}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
