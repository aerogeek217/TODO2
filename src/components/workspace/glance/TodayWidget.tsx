import { useEffect, useMemo } from 'react'
import type { TodayTab } from '../../../models/workspace-layout'
import { useStatsBase, useTileStats, useTodayPicks, useTodayRows } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import type { TodayReason, TodayPicks } from '../../../services/stats/today-picks'
import { pickForToday } from '../../../services/today-focus'
import { useUIStore } from '../../../stores/ui-store'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import { PlusIcon } from '../../shared/icons'
import { glanceDrill, GLANCE_PANEL_CLASS, useGlanceRows, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import type { TodoLookup } from './section-data'
import { Empty, Panel, RowsGrid, TaskRows, type PanelDef } from './section-parts'
import { metricDrill } from './glance-drills'
import styles from './BriefWidgets.module.css'
import sectionStyles from './GlanceSections.module.css'

const TODAY_DEF: PanelDef = { id: 'today', title: 'Today', glyph: 'focus', glyphColor: 'var(--color-marker-focus)' }

const REASON_TEXT: Record<TodayReason, string> = { dueToday: 'Due today', slipping: 'Slipping' }

/** The widget's lines for Copy: `Today 3`, then each Focus task's title. */
function todayLines(picks: TodayPicks, data: TodoLookup): SummaryPart[][] {
  return [
    [{ label: 'Today', count: String(picks.focusIds.length) }],
    ...picks.focusIds.flatMap((id) => {
      const t = data.todoById.get(id)
      return t ? [[{ label: t.title, count: '' }]] : []
    }),
  ]
}

function Suggestions({ picks, data }: { picks: TodayPicks; data: TodoLookup }) {
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const rows = picks.suggestions.flatMap((s) => {
    const todo = data.todoById.get(s.id)
    return todo ? [{ todo, reason: s.reason }] : []
  })
  if (rows.length === 0) return null
  return (
    <div className={styles.suggested} role="group" aria-label="Suggested" data-today-suggested="">
      <span className={styles.suggestedHead}>Suggested</span>
      {rows.map(({ todo, reason }) => (
        <div key={todo.id} className={styles.suggestion} data-suggestion={todo.id}>
          <button type="button" className={styles.pick} aria-label={`Add “${todo.title}” to Focus`} title="Add to Focus" onClick={() => void pickForToday(todo)}>
            <PlusIcon size={12} />
          </button>
          <button type="button" className={`${styles.drill} ${styles.suggestionTitle}`} onClick={() => openEditPopup(todo.id)}>
            {todo.title}
          </button>
          <span className={styles.reason} data-reason={reason}>{REASON_TEXT[reason]}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Today (D25 L): the open Focus tasks as task rows — the day's picks, its
 * own selection scope and bulk bar — and under them up to five suggestions
 * (due today, then the Neglect map's Slipping corner), each with a + that
 * puts it in Focus. The tab menu's Clear Focus… ends the day. Small:
 * `Today N`; medium: the Focus titles; large: the rows and suggestions.
 */
export function TodayWidget({ tab, onResult, onDrill }: GlanceWidgetProps<TodayTab>) {
  const base = useStatsBase()
  const rows = useGlanceRows(tab)
  const picks = useTodayPicks(base)
  const tiles = useTileStats(base)
  const lingering = useTodayRows(base, picks, rows.leaving)
  const [faceRef, face] = useWidgetFace()
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const { setShown } = rows
  useEffect(() => { setShown(lingering.rows) })
  const data: TodoLookup = { todoById: base.todoById }
  const lines = useMemo(() => todayLines(picks, { todoById: base.todoById }), [picks, base.todoById])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, base.filtered)
  const count = picks.focusIds.length
  const openFocus = drill ? () => drill({ ...metricDrill('focus', { tiles, ctx: base.ctx }), title: 'Today' }) : undefined

  if (face === 'small') {
    const content = (
      <>
        <span className={styles.todayLabel}><GlanceGlyph name="focus" size={12} color="var(--color-marker-focus)" />Today</span>
        <span className={styles.todayCount} data-testid="today-count">{count}</span>
      </>
    )
    return (
      <GlanceFrame tab={tab} rows={rows}>
        <div ref={faceRef} className={`${styles.face} ${styles.small}`} data-face="small">
          {openFocus
            ? <button type="button" className={`${styles.drill} ${styles.todaySmall}`} aria-label={`Today: ${count}. Show tasks`} onClick={openFocus}>{content}</button>
            : <span className={styles.todaySmall}>{content}</span>}
        </div>
      </GlanceFrame>
    )
  }

  return (
    <GlanceFrame tab={tab} rows={rows}>
      <div ref={faceRef} className={styles.face} data-face={face}>
        <Panel def={TODAY_DEF} className={`${GLANCE_PANEL_CLASS} ${styles.facePanel}`} count={String(count)} onCount={openFocus} sub="Focus">
          {face === 'medium' ? (
            count === 0
              ? <Empty title="Nothing picked for today" hint="Set Focus on the tasks you mean to do today." />
              : (
                <ul className={styles.titles} aria-label="Focus">
                  {picks.focusIds.map((id) => {
                    const t = base.todoById.get(id)
                    return t ? (
                      <li key={id}>
                        <button type="button" className={`${styles.drill} ${styles.title}`} onClick={() => openEditPopup(id)}>{t.title}</button>
                      </li>
                    ) : null
                  })}
                </ul>
              )
          ) : (
            <div ref={trackScrollEdges} className={sectionStyles.panelBody}>
              {lingering.rows.length === 0
                ? <Empty title="Nothing picked for today" hint="Pick a suggestion with +, or set Focus on any task." />
                : <RowsGrid kit={rows.kit}><TaskRows sectionKey="today" ids={lingering.rows} data={data} kit={rows.kit} kept={lingering.kept} /></RowsGrid>}
              <Suggestions picks={picks} data={data} />
            </div>
          )}
        </Panel>
      </div>
    </GlanceFrame>
  )
}
