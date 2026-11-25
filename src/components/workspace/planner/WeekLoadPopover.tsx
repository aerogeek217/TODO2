import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { usePopoverAnchor, type PopoverPlacement } from '../../../hooks/use-popover-anchor'
import { useToday } from '../../../hooks/use-today'
import { useWeekLoad } from '../../../hooks/use-week-load'
import { WEEK_LOAD_KINDS, type WeekLoad, type WeekLoadDay, type WeekLoadKind } from '../../../services/stats/week-load'
import { usePlannerStore } from '../../../stores/planner-store'
import { useUIStore } from '../../../stores/ui-store'
import { formatDateWith } from '../../../utils/date'
import { widgetElement } from '../../../utils/dom-contract'
import { ChevronLeftIcon, ChevronRightIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
import {
  chartScale,
  countsTotal,
  dayTotal,
  dayWords,
  emptyBoxWords,
  loadPill,
  WEEK_LOAD_COLOR,
  noteWords,
  partCount,
  partWords,
  slipPill,
  usualShown,
  weekRange,
  weekTitle,
  weekWords,
  weekLoadDrill,
  type WeekLoadPart,
} from './week-load-words'
import styles from './WeekLoad.module.css'

const LEGEND: ReadonlyArray<{ kind: WeekLoadKind; label: string }> = [
  { kind: 'due', label: 'Due' },
  { kind: 'followup', label: 'Follow-up' },
  { kind: 'planned', label: 'Planned' },
]

/**
 * The **week load** popover (`role=dialog`, `Week load`): one week's dates,
 * day by day, against the usual week. It opens on this week every time; `‹`
 * / `›` step back to the oldest week the result holds and ahead to the last,
 * inert at either end. Its parts, top down: the week's name and days (`This
 * week · Nov 23 – 29`); the load, `dates · usual 13` and the pills (`50%
 * slipped`, past weeks and this one; `6 over usual` / `Room for 4` / `At
 * usual`); the day chart; the legend; one line of words; the log-limit
 * notes. A day's column stacks one box per kind, due → follow-up → planned
 * from the bottom, outlined in the kind's color and filled from the bottom
 * as far as its dates were done — the rest slipped on a day gone by, still
 * ahead on a day to come — with a dashed mark at that weekday's usual
 * (`usual.perWeek × weekdayShares[i]`); its name says the day in words
 * (`dayWords`). Every column shares one scale (`chartScale`). Esc and a
 * press outside close it; the focus goes back to the meter (or, opened from
 * the ⋯ menu, to what opened it, else the widget).
 */
export function WeekLoadPopover({ load, anchorRef, placement, anchorIsInside = true, onClose, returnFocus }: {
  load: WeekLoad
  /** What it opens beside: the meter, or the widget (the ⋯ menu's Week load…). */
  anchorRef: RefObject<HTMLElement | null>
  placement: PopoverPlacement
  /** A press on the anchor is inside (the meter toggles it); `false` for the widget, where a press closes it. */
  anchorIsInside?: boolean
  onClose: () => void
  /** Where the focus goes as it closes (when it was inside); default the anchor, or its first control. */
  returnFocus?: () => void
}) {
  const today = useToday()
  const last = load.weeks.length - 1
  // This week's place in the result: where it opens every time.
  const [index, setIndex] = useState(() => Math.max(0, load.weeks.findIndex((w) => w.offset === 0)))
  const at = Math.min(index, last)
  const week = load.weeks[at]
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    onClose,
    placement,
    closeOnScroll: 'user',
    consumeEscape: true,
    anchorIsInside,
    caret: true,
  })
  const ownRef = useRef<HTMLDivElement | null>(null)
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    ownRef.current = el
    panelRef(el)
  }, [panelRef])
  const returnRef = useLatestRef(returnFocus)

  // The focus moves in as it opens, and goes back — to the meter, or what `returnFocus` says — when it was
  // inside (or nowhere) as it closed.
  useEffect(() => {
    ownRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => () => {
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected && !ownRef.current?.contains(active)) return
    if (returnRef.current) { returnRef.current(); return }
    const anchor = anchorRef.current
    const target = anchor?.matches('button') ? anchor : anchor?.querySelector<HTMLElement>('button, [tabindex]')
    target?.focus({ preventScroll: true })
  }, [anchorRef, returnRef])

  if (!week) return null
  const usual = usualShown(load)
  const scale = chartScale(load)
  const slip = slipPill(week)
  const pill = loadPill(week, usual)
  const step = (by: -1 | 1) => {
    const next = Math.min(last, Math.max(0, at + by))
    // An arrow going inert at an end would drop the focus: it stays in the popover.
    if (next === 0 || next === last) ownRef.current?.focus({ preventScroll: true })
    setIndex(next)
  }

  return createPortal(
    <PopoverRoot
      ref={setPanel}
      className={styles.popover}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      caret={caret}
      role="dialog"
      aria-label="Week load"
      tabIndex={-1}
      data-week-load-popover=""
      data-week-offset={week.offset}
    >
      <div className={styles.head}>
        <WeekStep direction={-1} disabled={at <= 0} onStep={step} />
        <span className={styles.title} data-testid="week-load-title">
          <b>{weekTitle(week.offset)}</b> <span className={styles.range}>· {weekRange(week)}</span>
        </span>
        <WeekStep direction={1} disabled={at >= last} onStep={step} />
      </div>
      <div className={styles.summary}>
        <span className={styles.big} data-testid="week-load-count">{week.totals.load}</span>
        <span className={styles.unit}>{week.totals.load === 1 ? 'date' : 'dates'} · usual {usual}</span>
        <span className={styles.pills}>
          {slip && <span className={`${styles.pill} ${styles.pillSlip}`} data-testid="week-load-slip">{slip}</span>}
          <span className={`${styles.pill} ${pill.over ? styles.pillOver : styles.pillRoom}`} data-testid="week-load-pill">{pill.text}</span>
        </span>
      </div>
      <div className={styles.chart}>
        {week.days.map((day, i) => (
          <DayColumn key={day.date.getTime()} day={day} scale={scale} usual={load.usual.perWeek * (load.usual.weekdayShares[i] ?? 0)} onDrill={onClose} />
        ))}
        <span className={styles.base} aria-hidden="true" />
        {week.days.map((day) => (
          <span key={day.date.getTime()} className={styles.dayLabel} data-today={day.when === 'today' ? '' : undefined} aria-hidden="true">
            <span className={styles.weekday}>{formatDateWith(day.date, { weekday: 'short' }).slice(0, 2)}</span>
            <span className={styles.date}>{day.date.getDate()}</span>
          </span>
        ))}
      </div>
      <div className={styles.legend}>
        {LEGEND.map(({ kind, label }) => (
          <span key={kind}><i className={styles.swatch} style={{ background: WEEK_LOAD_COLOR[kind] }} aria-hidden="true" />{label}</span>
        ))}
        <span><i className={styles.swatchLine} aria-hidden="true" />Usual</span>
        <span><i className={`${styles.swatch} ${styles.swatchHollow}`} aria-hidden="true" />{emptyBoxWords(week.offset)}</span>
      </div>
      <p className={styles.words} data-testid="week-load-words">{weekWords(week, usual)}</p>
      {week.notes.map((note) => (
        <p key={note.log} className={styles.note} data-testid="week-load-note">{noteWords(note, today)}</p>
      ))}
    </PopoverRoot>,
    document.body,
  )
}

function WeekStep({ direction, disabled, onStep }: { direction: -1 | 1; disabled: boolean; onStep: (by: -1 | 1) => void }) {
  const label = direction < 0 ? 'Previous week' : 'Next week'
  return (
    <button type="button" className={styles.arrow} aria-label={label} data-tooltip={label} disabled={disabled} onClick={() => onStep(direction)}>
      {direction < 0 ? <ChevronLeftIcon size={12} /> : <ChevronRightIcon size={12} />}
    </button>
  )
}

/**
 * One day's column: its count, then its boxes bottom up and the weekday's usual mark; a group named in words. Each
 * box is two buttons — its filled part (done) and the rest (slipped, or still ahead) —, each opening the task dialog
 * on its tasks (`weekLoadDrill`); the popover closes as it opens (`onDrill`).
 */
function DayColumn({ day, scale, usual, onDrill }: { day: WeekLoadDay; scale: number; usual: number; onDrill: () => void }) {
  const n = dayTotal(day)
  const words = dayWords(day)
  return (
    <div className={styles.day} role="group" aria-label={words} data-today={day.when === 'today' ? '' : undefined} data-week-load-day="">
      <span className={styles.dayCount} aria-hidden="true">{n || ''}</span>
      <span className={styles.column}>
        {WEEK_LOAD_KINDS.map((k) => {
          const c = day.kinds[k]
          const total = countsTotal(c)
          if (total === 0) return null
          return (
            <span
              key={k}
              className={styles.box}
              data-kind={k}
              style={{ height: `calc(${(100 * total) / scale}% - 1px)`, '--c': WEEK_LOAD_COLOR[k] } as CSSProperties}
            >
              {(['done', 'rest'] as const).map((part) => partCount(c, part) > 0 && (
                <BoxPart key={part} day={day} kind={k} part={part} share={(100 * partCount(c, part)) / total} onDrill={onDrill} />
              ))}
            </span>
          )
        })}
        {usual > 0 && <span className={styles.usualMark} style={{ bottom: `${(100 * usual) / scale}%` }} />}
      </span>
    </div>
  )
}

/** A box's part: a button as tall as its share, named (and its tooltip) in words; a click lists its tasks. */
function BoxPart({ day, kind, part, share, onDrill }: { day: WeekLoadDay; kind: WeekLoadKind; part: WeekLoadPart; share: number; onDrill: () => void }) {
  const words = partWords(day, kind, part)
  return (
    <button
      type="button"
      className={part === 'done' ? styles.partDone : styles.partRest}
      style={{ flexBasis: `${share}%` }}
      aria-label={`${words}. Show the tasks`}
      data-tooltip={words}
      data-week-load-part={part}
      onClick={() => {
        onDrill()
        useUIStore.getState().showTaskDialog(weekLoadDrill(day, kind, part))
      }}
    />
  )
}

/**
 * The popover opened from the widget's ⋯ menu (**Week load…**, `planner-store.weekLoadTabId`), where the Planner
 * has no top line for the meter (a cell of tabs, the widget popup, a narrow widget): beside the widget, hosted on
 * the workspace page. Closed with no Planner of that tab on screen.
 */
export function WeekLoadHost() {
  const tabId = usePlannerStore((s) => s.weekLoadTabId)
  return tabId == null ? null : <WeekLoadBeside key={tabId} tabId={tabId} />
}

function WeekLoadBeside({ tabId }: { tabId: string }) {
  const load = useWeekLoad()
  const close = usePlannerStore((s) => s.closeWeekLoad)
  // The widget it opens beside (the popup's, while the popup shows the tab), found as it opens.
  const [anchor] = useState(() => widgetElement(tabId, `[data-planner="${CSS.escape(tabId)}"]`))
  const anchorRef = useRef<HTMLElement | null>(anchor)
  // What had the focus as it opened (the ⋯ button, back from its menu): where the focus goes back to.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    if (!anchor) close()
  }, [anchor, close])
  const returnFocus = useCallback(() => {
    if (opener && opener !== document.body && opener.isConnected) { opener.focus({ preventScroll: true }); return }
    anchorRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true })
  }, [opener])
  if (!anchor || !load) return null
  return <WeekLoadPopover load={load} anchorRef={anchorRef} placement="right-start" anchorIsInside={false} onClose={close} returnFocus={returnFocus} />
}
