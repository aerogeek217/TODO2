import { useMemo } from 'react'
import type { ChangesTab } from '../../../models/workspace-layout'
import { useChanges, useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { NOTHING_CHANGED, type Change } from '../../../services/stats/changes'
import { formatDateWith } from '../../../utils/date'
import type { WidgetFace } from '../../../utils/widget-face'
import { changeDrill } from './glance-drills'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import styles from './BriefWidgets.module.css'

/** How many sentences each face shows: the headline alone, the first three, every one. */
const FACE_SENTENCES: Record<WidgetFace, number> = { small: 1, medium: 3, large: Infinity }

/** The widget's lines for Copy: a sentence each, or the quiet line. */
function changeLines(changes: readonly Change[] | null): SummaryPart[][] {
  if (!changes) return []
  if (changes.length === 0) return [[{ label: NOTHING_CHANGED, count: '' }]]
  return changes.map((c) => [{ label: c.text, count: '' }])
}

function Sentence({ change, headline, onDrill }: { change: Change; headline: boolean; onDrill: OnGlanceDrill | undefined }) {
  const className = `${styles.sentence}${headline ? ` ${styles.headline}` : ''}`
  const drill = changeDrill(change)
  if (drill && onDrill) {
    return (
      <button type="button" className={`${styles.drill} ${className}`} data-change={change.id} onClick={() => onDrill(drill)}>
        {change.text}
      </button>
    )
  }
  return <span className={className} data-change={change.id}>{change.text}</span>
}

/**
 * What changed (D25 L): the brief's text — template sentences on what went
 * late, the follow-ups, the picked tag with the most late tasks, a stuck
 * status, today's due dates and the week's closes (`services/stats/changes`)
 * — each opening its tasks. Small: the headline; medium: the first three;
 * large: every one, under today's date. Nothing to say: a quiet line.
 */
export function ChangesWidget({ tab, onResult, onDrill }: GlanceWidgetProps<ChangesTab>) {
  const base = useStatsBase()
  const changes = useChanges(base, tab.config.tagIds)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => changeLines(changes), [changes])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, base.filtered)
  const shown = (changes ?? []).slice(0, FACE_SENTENCES[face])
  return (
    <GlanceFrame tab={tab}>
      <div
        ref={faceRef}
        className={`${styles.face} ${styles.brief}${face === 'small' ? ` ${styles.small}` : ''}`}
        data-face={face}
        aria-busy={changes ? undefined : true}
      >
        {face !== 'small' && (
          <span className={styles.briefDate}>{formatDateWith(base.ctx.today, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        )}
        {changes && changes.length === 0 && <p className={styles.quiet} data-change="none">{NOTHING_CHANGED}</p>}
        {shown.length > 0 && (
          <ul className={styles.sentences} aria-label="What changed">
            {shown.map((c, i) => <li key={c.id}><Sentence change={c} headline={i === 0} onDrill={drill} /></li>)}
          </ul>
        )}
      </div>
    </GlanceFrame>
  )
}
