import { useMemo } from 'react'
import type { PeopleTab } from '../../../models/workspace-layout'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { usePeopleStats, useStatsBase } from '../../../hooks/use-glance-data'
import type { PeopleStats } from '../../../services/stats/people'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { peopleLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { inSortOrder, priorityWords, type TodoLookup } from './section-data'
import { SECTION_META } from './section-meta'
import { Count, Empty, Panel, PriorityBadges, type SectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What People reads. */
export interface PeopleSectionData extends TodoLookup {
  people: PeopleStats
}

/** People: each person's open tasks, by priority and follow-ups due; Unassigned last (an option). */
export function PeopleSection({ data, options, onDrill, style, className }: SectionProps<PeopleSectionData>) {
  const { rows, unassigned } = data.people
  const showUnassigned = options.showUnassigned !== false && unassigned.ids.length > 0
  const max = Math.max(1, ...rows.map((r) => r.ids.length), showUnassigned ? unassigned.ids.length : 0)
  const all = useMemo(() => [
    ...rows.map((r) => ({ key: String(r.person.id), person: r.person, stats: r })),
    ...(showUnassigned ? [{ key: 'none', person: null, stats: unassigned }] : []),
  ], [rows, unassigned, showUnassigned])
  return (
    <Panel def={SECTION_META.people} style={style} className={`${styles.peoplePanel}${className ? ` ${className}` : ''}`} sub="Open tasks by person">
      {all.length === 0 ? (
        <Empty title="No open tasks" hint="Open tasks show here by person." />
      ) : (
        <>
          <div className={`${styles.peopleGrid} ${styles.peopleHead}`}>
            <span>Person</span><span>Open</span><span className={styles.peopleHeadGap} /><span className={styles.num}>Priority</span><span className={styles.num}>Follow-up</span>
          </div>
          <div ref={trackScrollEdges} className={styles.panelBody}>
            {all.map(({ key, person, stats }) => {
              const name = person ? person.name : 'Unassigned'
              const open = stats.ids.length
              // In each task's own order, as the person chip lists them.
              const onClick = onDrill
                ? () => onDrill({
                  title: name,
                  glyph: 'people',
                  description: person ? `Open tasks assigned to ${person.name}.` : 'Open tasks with nobody assigned.',
                  source: { kind: 'todos', todoIds: inSortOrder(stats.ids, data) },
                  ...(person?.id != null ? { personId: person.id } : {}),
                })
                : null
              const content = (
                <>
                  <span className={styles.personName}>
                    {person
                      ? <i className={styles.avatar} style={{ background: person.color || NEUTRAL_PERSON_COLOR }}>{(person.initials || person.name).charAt(0).toUpperCase()}</i>
                      : <i className={`${styles.avatar} ${styles.avatarNone}`} />}
                    <span>{name}</span>
                  </span>
                  <span className={styles.peopleBar}><span style={{ width: `${Math.round((open / max) * 100)}%` }} /></span>
                  <span className={styles.num}>{open}</span>
                  <PriorityBadges counts={stats.priority} />
                  <Count n={stats.followupDueIds.length} color="var(--color-followup)" />
                </>
              )
              const cls = `${styles.peopleGrid} ${styles.personRow}`
              return onClick ? (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  data-person-row={key}
                  aria-label={`${name}: ${open} open, ${priorityWords(stats.priority)}${stats.followupDueIds.length} follow-up due`}
                  onClick={onClick}
                >
                  {content}
                </button>
              ) : (
                <div key={key} className={cls} data-person-row={key}>{content}</div>
              )
            })}
          </div>
        </>
      )}
    </Panel>
  )
}

/** The People widget: the section filling its cell. */
export function PeopleWidget({ tab, onResult, onDrill }: GlanceWidgetProps<PeopleTab>) {
  const { showUnassigned } = tab.config
  const base = useStatsBase()
  const people = usePeopleStats(base)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => peopleLines(people, showUnassigned), [people, showUnassigned])
  useReportLines(onResult, lines)
  const top = people.rows.at(0)
  // Nobody with a task: Unassigned's, when the widget shows it.
  const topName = top ? top.person.name : showUnassigned && people.unassigned.ids.length > 0 ? 'Unassigned' : undefined
  const topCount = top ? top.ids.length : topName ? people.unassigned.ids.length : 0
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.people.glyph}
          glyphColor={SECTION_META.people.glyphColor}
          title={SECTION_META.people.title}
          entry={topName}
          value={String(topCount)}
          caption="open"
        />
      ) : <PeopleSection
        data={{ people, todoById: base.todoById }}
        options={{ showUnassigned }}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
