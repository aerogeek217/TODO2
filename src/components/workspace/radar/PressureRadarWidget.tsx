import { memo, useCallback, type CSSProperties } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { RadarTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { TODO_ID_ATTR } from '../../../utils/dom-contract'
import {
  buildPressureRadar,
  quarterTasks,
  RADAR_QUARTER_NAMES,
  RADAR_QUARTERS,
  RADAR_RINGS,
  radarPointText,
  type PressureRadar,
  type RadarPoint,
  type RadarQuarter,
} from '../../../utils/pressure-radar'
import { sharedMemo } from '../../../utils/shared-memo'
import { taskMapFaceFor, type WidgetFace } from '../../../utils/widget-face'
import { useTooltip } from '../../shared/use-tooltip'
import { radarNowDrill, radarQuarterDrill } from '../glance/glance-drills'
import { WidgetNameLine } from '../WidgetTopLine'
import styles from './PressureRadarWidget.module.css'

/** At this body width and wider the rules sit beside the radar. */
const RADAR_LEGEND_MIN_PX = 720
/** The rules' column. */
const LEGEND_WIDTH_PX = 210
/** Room kept around the radar for the quarters' words in its corners. */
const RADAR_PAD_PX = 12

/** What decides each quarter, as its rule line says it. */
const QUARTER_RULES: Record<RadarQuarter, string> = {
  due: 'Its due date comes first.',
  followup: 'Its next follow-up comes first.',
  waiting: 'A Waiting status: chase at its next follow-up, else a week after the last.',
  untouched: 'No date at all: by when it goes stale.',
}

const radarMemo = sharedMemo((
  shown: readonly PersistedTodoItem[],
  today: Date,
  waitingStatusIds: readonly number[],
  staleAfterDays: number,
): PressureRadar<PersistedTodoItem> => buildPressureRadar(shown, { today, waitingStatusIds: new Set(waitingStatusIds), staleAfterDays }), 2)

/** Every open task the screen filter keeps, on the radar (the glance widgets' shared base). */
function usePressureRadar(tab: RadarTab): PressureRadar<PersistedTodoItem> {
  const base = useStatsBase()
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  return radarMemo(base.shown, base.ctx.today, tab.config.waitingStatusIds, staleAfterDays)
}

const showDialog = (drill: Parameters<ReturnType<typeof useUIStore.getState>['showTaskDialog']>[0]) => useUIStore.getState().showTaskDialog(drill)

function openQuarter(radar: PressureRadar<PersistedTodoItem>, quarter: RadarQuarter) {
  showDialog(radarQuarterDrill(quarter, quarterTasks(radar, quarter).map((p) => p.todo.id)))
}

function openNow(radar: PressureRadar<PersistedTodoItem>) {
  showDialog(radarNowDrill(radar.now.map((p) => p.todo.id)))
}

/**
 * The Pressure radar (task maps R1, 2026-11-18): every open task the
 * screen filter keeps, in four quarters by what presses on it — Due date,
 * Follow-up, Waiting, Untouched (`utils/pressure-radar`) — nearer the middle
 * the sooner it needs you. Inside the NOW disk, solid: it needs you now.
 * A quarter's word (its count, how many now) and the disk open their tasks
 * in the task dialog; a dot opens its task. Faces (`taskMapFaceFor`): small,
 * how many need you now; medium, the quarters as rows.
 */
export function PressureRadarWidget({ tab }: { tab: RadarTab }) {
  const [faceRef, face] = useWidgetFace(taskMapFaceFor)
  return (
    <div ref={faceRef} className={styles.faceHost}>
      {face === 'large' ? <RadarFull tab={tab} /> : <RadarFace tab={tab} face={face} />}
    </div>
  )
}

/** Small: how many need you now, of the open tasks. Medium: the quarters as rows. */
function RadarFace({ tab, face }: { tab: RadarTab; face: Exclude<WidgetFace, 'large'> }) {
  const radar = usePressureRadar(tab)
  const now = radar.now.length
  if (face === 'small') {
    return (
      <div className={styles.smallFace} role="group" aria-label={`Need you now: ${now} of ${radar.points.length} open`} data-radar-face="small">
        <span className={styles.smallTitle}>Need you now</span>
        <span className={styles.smallFigures}>
          <span className={styles.smallCount} data-lit={now > 0 ? 'true' : undefined} data-testid="radar-face-count">{now}</span>
          <span className={styles.smallCaption}>of {radar.points.length} open</span>
        </span>
      </div>
    )
  }
  return (
    <>
      <WidgetNameLine name="Pressure radar">
        <span className={styles.lineNow}>Need you now <b>{now}</b></span>
      </WidgetNameLine>
      <div className={styles.mediumFace} data-radar-face="medium">
        {RADAR_QUARTERS.map((q) => (
          <QuarterRow key={q} quarter={q} radar={radar} />
        ))}
      </div>
    </>
  )
}

/** A quarter as a row of the medium face: its mark, its name, how many now, how many in all. */
function QuarterRow({ quarter, radar }: { quarter: RadarQuarter; radar: PressureRadar<PersistedTodoItem> }) {
  const { total, now } = radar.counts[quarter]
  return (
    <button
      type="button"
      className={styles.quarterRow}
      data-quarter={quarter}
      disabled={total === 0}
      aria-label={`${RADAR_QUARTER_NAMES[quarter]}: ${total} open, ${now} need you now`}
      onClick={() => openQuarter(radar, quarter)}
    >
      <span className={styles.mark} aria-hidden="true" />
      <span className={styles.rowName}>{RADAR_QUARTER_NAMES[quarter]}</span>
      <span className={styles.rowNow}>{now > 0 ? `${now} now` : ''}</span>
      <span className={styles.rowTotal}>{total}</span>
    </button>
  )
}

interface DotProps {
  point: RadarPoint<PersistedTodoItem>
  marked: boolean
  staleAfterDays: number
  onOpen: (todoId: number) => void
}

/** A task's dot: its tooltip says what presses on it; a click opens it. Memoized: plain props. */
const Dot = memo(function Dot({ point, marked, staleAfterDays, onOpen }: DotProps) {
  const meta = `${RADAR_QUARTER_NAMES[point.quarter]} · ${radarPointText(point.quarter, point.needsIn, staleAfterDays)}`
  const { triggerProps, tooltip } = useTooltip(`${point.todo.title}\n${meta}`)
  const rad = (point.angle * Math.PI) / 180
  const style = {
    left: `${50 + 50 * point.r * Math.cos(rad)}%`,
    top: `${50 + 50 * point.r * Math.sin(rad)}%`,
  } as CSSProperties
  return (
    <button
      type="button"
      className={styles.dot}
      style={style}
      aria-label={`${point.todo.title}: ${meta}`}
      data-radar-dot={point.quarter}
      data-now={point.needsIn <= 0 ? 'true' : undefined}
      data-marked={marked ? 'true' : undefined}
      {...{ [TODO_ID_ATTR]: point.todo.id }}
      {...triggerProps}
      onClick={() => onOpen(point.todo.id)}
    >
      {tooltip}
    </button>
  )
})

/** A quarter's word in its corner of the radar: its name, its count and how many need you now. */
function QuarterWord({ quarter, radar }: { quarter: RadarQuarter; radar: PressureRadar<PersistedTodoItem> }) {
  const { total, now } = radar.counts[quarter]
  const name = RADAR_QUARTER_NAMES[quarter]
  const words = (
    <>
      <span className={styles.wordName}>{name}</span>
      <span className={styles.wordCounts}>{total}{now > 0 ? ` · ${now} now` : ''}</span>
    </>
  )
  if (total === 0) return <span className={styles.word} data-quarter={quarter} data-radar-word={quarter}>{words}</span>
  return (
    <button
      type="button"
      className={`${styles.word} ${styles.wordButton}`}
      data-quarter={quarter}
      data-radar-word={quarter}
      aria-label={`${name}: show ${total} ${total === 1 ? 'task' : 'tasks'}, ${now} need you now`}
      onClick={() => openQuarter(radar, quarter)}
    >
      {words}
    </button>
  )
}

/** The whole radar (its large face). */
function RadarFull({ tab }: { tab: RadarTab }) {
  const isMobile = useIsMobile()
  const radar = usePressureRadar(tab)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const [bodyRef, body] = useElementSize()
  const legend = !isMobile && body.width >= RADAR_LEGEND_MIN_PX
  // The square: the body's height (a phone's: its width), less the legend's column beside it.
  const room = body.width - (legend ? LEGEND_WIDTH_PX + 16 : 0)
  const side = Math.max(0, Math.floor((isMobile ? room : Math.min(room, body.height)) - RADAR_PAD_PX * 2))
  const open = useCallback((id: number) => openEditPopup(id), [openEditPopup])
  const now = radar.now.length
  const empty = radar.points.length === 0

  return (
    <>
      <WidgetNameLine name="Pressure radar">
        <span className={styles.lineNow} data-testid="radar-line-now">Need you now <b>{now}</b></span>
      </WidgetNameLine>
      <div ref={bodyRef} className={styles.widget} data-radar={tab.id} data-legend={legend ? 'true' : undefined} data-mobile={isMobile ? 'true' : undefined}>
        <div className={styles.stage} style={isMobile ? { height: side + RADAR_PAD_PX * 2 } : undefined}>
          {side > 0 && (
            <div className={styles.field} style={{ width: side, height: side }} role="group" aria-label="Pressure radar: open tasks by what presses on them, nearer the middle the sooner they need you">
              <div className={styles.rim} aria-hidden="true" />
              <div className={styles.ring} style={ringStyle(RADAR_RINGS.threeWeeks)} aria-hidden="true" />
              <div className={styles.ring} style={ringStyle(RADAR_RINGS.week)} aria-hidden="true" />
              <div className={styles.axisX} aria-hidden="true" />
              <div className={styles.axisY} aria-hidden="true" />
              <button
                type="button"
                className={styles.nowDisk}
                style={ringStyle(RADAR_RINGS.now)}
                disabled={now === 0}
                aria-label={`Need you now: show ${now} ${now === 1 ? 'task' : 'tasks'}`}
                data-testid="radar-now"
                onClick={() => openNow(radar)}
              />
              <span className={styles.ringLabel} style={{ top: `${50 - 50 * RADAR_RINGS.now}%` }} aria-hidden="true">Now</span>
              <span className={styles.ringLabel} style={{ top: `${50 - 50 * RADAR_RINGS.week}%` }} aria-hidden="true">7 days</span>
              <span className={styles.ringLabel} style={{ top: `${50 - 50 * RADAR_RINGS.threeWeeks}%` }} aria-hidden="true">21 days</span>
              {radar.points.map((p) => (
                <Dot
                  key={p.todo.id}
                  point={p}
                  marked={p.todo.urgent === true || p.todo.important === true || p.todo.focus === true}
                  staleAfterDays={staleAfterDays}
                  onOpen={open}
                />
              ))}
              {/* The quarters' words in the field's corners, outside the circle. */}
              {RADAR_QUARTERS.map((q) => <QuarterWord key={q} quarter={q} radar={radar} />)}
            </div>
          )}
          {empty && <p className={styles.empty} role="status">No open tasks to place.</p>}
        </div>
        {legend && (
          <aside className={styles.legend} aria-label="How tasks are placed">
            <span className={styles.legendTitle}>Each task sits where it presses hardest</span>
            {RADAR_QUARTERS.map((q) => (
              <div key={q} className={styles.rule} data-quarter={q}>
                <span className={styles.mark} aria-hidden="true" />
                <span className={styles.ruleText}>
                  <span className={styles.ruleName}>{RADAR_QUARTER_NAMES[q]}</span>
                  <span className={styles.ruleWhat}>{QUARTER_RULES[q]}</span>
                </span>
              </div>
            ))}
            <span className={styles.legendNote}>Solid: needs you now. Faint: coming up. Larger: a priority.</span>
          </aside>
        )}
      </div>
    </>
  )
}

/** A ring of `share` of the radius, centred in the field. */
function ringStyle(share: number): CSSProperties {
  const d = `${share * 100}%`
  return { width: d, height: d }
}
