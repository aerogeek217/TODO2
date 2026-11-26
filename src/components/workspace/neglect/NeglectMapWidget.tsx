import { memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { NeglectTab } from '../../../models/workspace-layout'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import { useElementSize } from '../../../hooks/use-element-size'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useToday } from '../../../hooks/use-today'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import type { WidgetFace } from '../../../utils/widget-face'
import type { StatsContext } from '../../../services/stats/stats-context'
import { neglectZoneReviewFilter, type NeglectReviewZone } from '../../../services/review'
import { jumpToPopupReview } from '../../../services/review-jump'
import { neglectZoneDrill } from '../glance/glance-drills'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useScreenFilter } from '../../../stores/screen-filter'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { ROW_KEY_ATTR, ROW_TODO_ATTR, SELECTION_SCOPE_ATTR, TODO_ID_ATTR } from '../../../utils/dom-contract'
import { isFollowupOverdue } from '../../../utils/followup'
import {
  buildNeglectMap,
  dateInText,
  NEGLECT_X_CAP,
  NEGLECT_Y_MAX,
  NEGLECT_Y_MIN,
  neglectDotColour,
  staleLineShown,
  untouchedText,
  type NeglectMap,
  type NeglectPoint,
  type NeglectZone,
} from '../../../utils/neglect-map'
import { placeNeglectLabels, uncrowdedMarks, type LabelDot, type LabelRect, type PlacedLabel } from '../../../utils/neglect-labels'
import { rowKey, type ScopedRow } from '../../../utils/scoped-selection'
import { sharedMemo } from '../../../utils/shared-memo'
import type { UrgentDueWithinDays } from '../../../utils/urgency'
import { screenFilterCount, screenUnhideAction } from '../../shared/filters/screen-hides'
import { ReviewIcon } from '../../shared/icons'
import { useTooltip } from '../../shared/use-tooltip'
import { appTextWidth } from '../../task/text-width'
import { ListBulkBar } from '../list/ListBulkBar'
import { WidgetNameLine } from '../WidgetTopLine'
import styles from './NeglectMapWidget.module.css'

/**
 * At this width and wider the Slipping list sits beside the plot. Narrower,
 * the plot has the whole widget and there is no list: a quadrant's word
 * opens its tasks instead (a phone keeps the list, under the plot).
 */
const NEGLECT_SIDE_LIST_MIN_PX = 900

/** The Slipping list numbers this many tasks (and badges their dots); the rest open in the task dialog. */
export const SLIPPING_LISTED = 9

/** The section key of the map's dots in the selection (`rowKey`). */
const SECTION = 'map'

const ZONE_NAMES: Record<NeglectZone, string> = {
  slipping: 'Slipping',
  inHand: 'In hand',
  later: 'Later',
  drifting: 'Drifting',
  forgotten: 'Forgotten',
  noDates: 'No dates',
}

/** Days untouched past which a dot's badge sits on its left (it would leave the plot on the right). */
const BADGE_FLIP_X = 54

/** Days untouched as a place across the plot, a percentage. */
const xPct = (x: number) => (x / NEGLECT_X_CAP) * 100
/** A due-in value's place down the plot, as a percentage (late at the top). */
const yPct = (y: number) => ((y - NEGLECT_Y_MIN) / (NEGLECT_Y_MAX - NEGLECT_Y_MIN)) * 100
/** A strip place (0 – 1) down the strip, as a percentage: under its labels, in its lower part. */
const stripPct = (y: number) => 70 + (y - 0.5) * 30

/** A task's name beside its dot: `.dotLabel`'s font (11px, medium). */
const LABEL_FONT_PX = 11
const LABEL_FONT_WEIGHT = 500
/** A dot's half size as drawn, its ring included: 9px (13px with a priority flag), the surface ring, a late follow-up's ring. */
const dotRadius = (marked: boolean, followupLate: boolean) => (marked ? 6.5 : 4.5) + (followupLate ? 3 : 1.5)
/** A Slipping badge's box (one digit: `SLIPPING_LISTED` is 9). */
const BADGE_PX = 14

/** A zone word's Review button and the gap before it, px (`.zoneReview`). */
const ZONE_REVIEW_PX = 22 + 6

/**
 * The box of one of the plot's own words (11px bold caps, 0.08em apart), `at`
 * its corner of a field `w` × `h`; `extra` px wider for a Review button beside it.
 */
function wordRect(word: string, at: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', w: number, h: number, top = 0, extra = 0): LabelRect {
  const width = appTextWidth(word.toUpperCase(), LABEL_FONT_PX, 700) + word.length * LABEL_FONT_PX * 0.08 + 4 + extra
  const height = LABEL_FONT_PX + 3
  const left = at.endsWith('left') ? 0 : w - width
  const y = at.startsWith('top') ? top : h - height
  return { left, right: left + width, top: y, bottom: y + height }
}

/**
 * A zone's word in its corner of the plot (or along the strip's top), with
 * how many tasks it holds: a button that opens them as a list (the task
 * dialog) while it holds any, plain words while it holds none.
 */
function ZoneWord({ zone, text, count, className, onOpen, testId }: {
  zone: NeglectZone
  /** The words shown (`Slipping 4`, `No dates · 2`). */
  text: string
  count: number
  className: string
  onOpen: (zone: NeglectZone) => void
  testId?: string
}) {
  if (count === 0) return <span className={className} aria-hidden="true" data-testid={testId}>{text}</span>
  return (
    <button
      type="button"
      className={`${className} ${styles.zoneWord}`}
      aria-label={`${ZONE_NAMES[zone]}: show ${count} ${count === 1 ? 'task' : 'tasks'}`}
      data-neglect-zone={zone}
      data-testid={testId}
      onClick={() => onOpen(zone)}
    >
      {text}
    </button>
  )
}

/** `the 3 slipping tasks` / `the forgotten task`. */
function zoneTasks(zone: NeglectReviewZone, count: number): string {
  return count === 1 ? `the ${zone} task` : `the ${count} ${zone} tasks`
}

/**
 * A zone's Review: opens the popup review on the zone written as an
 * expression (`neglectZoneReviewFilter`), whatever the layout holds. Beside
 * a zone word it is a 22px icon, shown while the pointer is on the map (and
 * always on a phone); over the list it reads `Review`.
 */
function ZoneReviewButton({ zone, count, onReview, labeled = false }: {
  zone: NeglectReviewZone
  count: number
  onReview: (zone: NeglectReviewZone) => void
  labeled?: boolean
}) {
  const name = `Review ${zoneTasks(zone, count)}`
  const { triggerProps, tooltip } = useTooltip(name)
  return (
    <button
      type="button"
      className={labeled ? styles.listReview : styles.zoneReview}
      aria-label={name}
      data-neglect-review={zone}
      {...triggerProps}
      onClick={() => onReview(zone)}
    >
      <ReviewIcon size={labeled ? 14 : 13} />
      {labeled && <span aria-hidden="true">Review</span>}
      {tooltip}
    </button>
  )
}

/**
 * A reviewable zone's word (Slipping, Drifting, Forgotten) with its Review
 * button beside it while it holds any task, placed in its corner by
 * `className`.
 */
function ZoneWithReview({ zone, text, count, className, onOpen, onReview, testId }: {
  zone: NeglectReviewZone
  text: string
  count: number
  className: string
  onOpen: (zone: NeglectZone) => void
  onReview: (zone: NeglectReviewZone) => void
  testId?: string
}) {
  return (
    <span className={`${className} ${styles.zoneGroup}`}>
      <ZoneWord zone={zone} text={text} count={count} className={styles.groupWord ?? ''} onOpen={onOpen} testId={testId} />
      {count > 0 && <ZoneReviewButton zone={zone} count={count} onReview={onReview} />}
    </span>
  )
}

/** A name placed beside its dot (`placeNeglectLabels`): at the dot's spot, pushed off it by its offset. */
function DotLabel({ point, label, noDue }: { point: NeglectPoint<PersistedTodoItem>; label: PlacedLabel; noDue: boolean }) {
  const style = {
    left: `${xPct(point.x)}%`,
    top: noDue ? `${stripPct(point.y)}%` : `${yPct(point.y)}%`,
    width: label.width,
    '--label-offset': `${label.offset}px`,
  } as CSSProperties
  return (
    // The dot's own name says it: this is its picture.
    <span className={styles.dotLabel} style={style} data-side={label.side} data-neglect-label={point.todo.id} aria-hidden="true">
      {point.todo.title}
    </span>
  )
}

/** What a dot says (its label and tooltip lines). */
function pointLines(p: NeglectPoint<PersistedTodoItem>, followupLate: boolean): [string, string] {
  const meta = [dateInText(p.dateIn, p.dateBy), untouchedText(p.untouched), ...(followupLate ? ['follow-up late'] : [])].join(' · ')
  return [p.todo.title, `${ZONE_NAMES[p.zone]} · ${meta}`]
}

interface DotProps {
  point: NeglectPoint<PersistedTodoItem>
  colour: string | null
  marked: boolean
  followupLate: boolean
  badge: number | null
  selected: boolean
  /** Opens the task; with Ctrl / ⌘ / Shift, adds it to or takes it out of the selection instead. */
  onActivate: (point: NeglectPoint<PersistedTodoItem>, mods: { shift: boolean; ctrl: boolean }) => void
  /** `false` on phones: the dot isn't part of a selection scope. */
  selectable: boolean
}

/**
 * A dot. Memoized (cr34 G9): its props are the point and plain values, so a
 * render of the map — a selection change, a new size — draws again only the
 * dots that changed, not every one with its tooltip.
 */
const Dot = memo(function Dot({ point, colour, marked, followupLate, badge, selected, onActivate, selectable }: DotProps) {
  const [title, meta] = pointLines(point, followupLate)
  const { triggerProps, tooltip } = useTooltip(`${title}\n${meta}`)
  const noDue = point.dateIn == null
  const style = {
    left: `${xPct(point.x)}%`,
    top: noDue ? `${stripPct(point.y)}%` : `${yPct(point.y)}%`,
    ...(colour ? { '--dot-colour': colour } : {}),
  } as CSSProperties
  const key = rowKey(SECTION, point.todo.id)
  return (
    <button
      type="button"
      className={styles.dot}
      style={style}
      aria-label={`${title}: ${meta}`}
      data-neglect-dot={point.zone}
      data-selected={selected ? 'true' : undefined}
      data-marked={marked ? 'true' : undefined}
      data-followup-late={followupLate ? 'true' : undefined}
      data-coloured={colour ? 'true' : undefined}
      // Near the right edge the badge goes on the dot's left, inside the plot.
      data-badge-side={badge != null && point.x > BADGE_FLIP_X ? 'left' : undefined}
      {...{ [TODO_ID_ATTR]: point.todo.id }}
      {...(selectable ? { [ROW_KEY_ATTR]: key, [ROW_TODO_ATTR]: point.todo.id } : {})}
      {...triggerProps}
      onClick={(e) => onActivate(point, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
    >
      {badge != null && <span className={styles.dotBadge} aria-hidden="true">{badge}</span>}
      {tooltip}
    </button>
  )
})

/** The rectangle a lasso drag covers, in the chart's own px. */
interface Lasso {
  x: number
  y: number
  w: number
  h: number
}

/** What the lasso's drag tells its rectangle: where it is now, or `null` once it ends. */
interface LassoBoxHandle {
  show: (rect: Lasso | null) => void
}

/**
 * The lasso's rectangle. Its place is its own state (cr34 G9), set by the
 * drag through `ref`: each pointer move re-renders this one element, not the
 * map and every dot on it.
 */
function LassoBox({ ref }: { ref: Ref<LassoBoxHandle> }) {
  const [rect, setRect] = useState<Lasso | null>(null)
  useImperativeHandle(ref, () => ({ show: setRect }), [])
  if (!rect) return null
  return (
    <div
      className={styles.lasso}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      aria-hidden="true"
      data-testid="neglect-lasso"
    />
  )
}

/**
 * Lasso selection over the chart: a drag that starts on empty plot (not on
 * a dot) draws a rectangle (`LassoBox`, through `boxRef`); on release the
 * dots inside it are the widget's selection (Ctrl / ⌘ / Shift add to it). A
 * drag that catches none clears the widget's selection, as a click outside
 * the rows does. The drag keeps no state in the map: nothing but the
 * rectangle renders while it runs.
 */
function useLasso(enabled: boolean, onSelect: (ids: number[], additive: boolean) => void) {
  const boxRef = useRef<LassoBoxHandle>(null)
  /** Past the drag threshold: the rectangle is drawn and the pointer captured. */
  const draggingRef = useRef(false)
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0 || !(e.target instanceof Element)) return
    // A dot, or the note's button: its own click.
    if (e.target.closest('button')) return
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  const rectOf = (el: HTMLElement, e: ReactPointerEvent<HTMLDivElement>, start: { x: number; y: number }): Lasso => {
    const box = el.getBoundingClientRect()
    const x0 = Math.min(start.x, e.clientX)
    const y0 = Math.min(start.y, e.clientY)
    return { x: x0 - box.left, y: y0 - box.top, w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start || start.id !== e.pointerId) return
    if (!draggingRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_ACTIVATION_DISTANCE_PX) return
      // Captured only once it is a drag, so a plain click keeps its target.
      e.currentTarget.setPointerCapture?.(e.pointerId)
      draggingRef.current = true
    }
    boxRef.current?.show(rectOf(e.currentTarget, e, start))
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = startRef.current
    startRef.current = null
    if (!start || start.id !== e.pointerId) return
    if (!draggingRef.current) return
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    boxRef.current?.show(null)
    if (cancelled) return
    const r = rectOf(e.currentTarget, e, start)
    const box = e.currentTarget.getBoundingClientRect()
    const ids: number[] = []
    for (const dot of e.currentTarget.querySelectorAll<HTMLElement>('[data-neglect-dot]')) {
      const d = dot.getBoundingClientRect()
      const cx = d.left + d.width / 2 - box.left
      const cy = d.top + d.height / 2 - box.top
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        const id = Number(dot.getAttribute(TODO_ID_ATTR))
        if (Number.isFinite(id)) ids.push(id)
      }
    }
    onSelect(ids, e.shiftKey || e.ctrlKey || e.metaKey)
  }
  return {
    boxRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => end(e, false),
      onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => end(e, true),
    },
  }
}

/** `14d late` · `Today` · `+3d` · `+30d`: the y axis's marks, as (value, label). */
function yMarks(dueSoonDays: number | null): Array<{ y: number; label: string; key: string }> {
  const marks = [
    { y: NEGLECT_Y_MIN, label: `${-NEGLECT_Y_MIN}d late`, key: 'top' },
    { y: 0, label: 'Today', key: 'today' },
  ]
  if (dueSoonDays != null && dueSoonDays > 0 && dueSoonDays < NEGLECT_Y_MAX) marks.push({ y: dueSoonDays, label: `+${dueSoonDays}d`, key: 'soon' })
  marks.push({ y: NEGLECT_Y_MAX, label: `+${NEGLECT_Y_MAX}d`, key: 'bottom' })
  return marks
}

/** The axis marks' font: `--font-size-xs`, one line. */
const MARK_FONT_PX = 11

/** Where a mark's label lies along its axis, px: after `at` (the top, `0d`), before it (the bottom, the cap) or centred on it. */
function markSpan(key: string, at: number, size: number): { start: number; end: number } {
  if (key === 'top' || key === 'zero') return { start: at, end: at + size }
  if (key === 'bottom' || key === 'cap') return { start: at - size, end: at }
  return { start: at - size / 2, end: at + size / 2 }
}

/**
 * `0d` · Stale after · `30d` · `60d+ untouched`: the x axis's marks (Stale
 * after's replaces a mark it would crowd; none while it is off or past the cap).
 */
function xMarks(staleAfterDays: number): Array<{ x: number; label: string; key: string }> {
  const marks = [{ x: 0, label: '0d', key: 'zero' }]
  const line = staleLineShown(staleAfterDays)
  if (line) marks.push({ x: staleAfterDays, label: `${staleAfterDays}d`, key: 'threshold' })
  if (!line || Math.abs(staleAfterDays - 30) > 6) marks.push({ x: 30, label: '30d', key: 'mid' })
  marks.push({ x: NEGLECT_X_CAP, label: `${NEGLECT_X_CAP}d+ untouched`, key: 'cap' })
  return marks
}

/**
 * The Neglect map widget (D25 board H): every open task the screen filter
 * keeps, as a dot placed by how long it has gone untouched
 * (across, capped at 60 days) and how soon its due date or next follow-up
 * is, whichever comes first (down: 14 days late at the top, today, the
 * due-soon line, 30 days ahead at the bottom; tasks with neither in the
 * strip under it, a task with only a planned day nowhere). The top-right
 * corner — soon or late and stale (Settings' Stale after) — is Slipping,
 * listed beside the plot when the widget is wide (`NEGLECT_SIDE_LIST_MIN_PX`;
 * under it on a phone; a narrower widget has no list and its plot fills
 * it). **Each zone's word carries its count and opens its tasks as a list**
 * (the task dialog): Slipping, In hand, Later and Drifting in the plot's
 * corners, No dates and Forgotten along the strip. A dot's colour is the
 * tab's Colour by (a picked tag's, the first person's, or neutral); a
 * priority flag makes it larger, a late follow-up rings it yellow. **A
 * task's name stands beside its dot where it fits** (`utils/neglect-labels`:
 * right of it, else left, clear of every dot, badge, other name and the
 * plot's own words; the Slipping tasks first; cut with an ellipsis where
 * there is less room than the name, absent where there is too little) — so
 * a bigger map names more of its tasks. A click
 * opens the task; a drag on empty plot lassoes dots into the widget's
 * selection, which the bulk bar acts on.
 */
export function NeglectMapWidget({ tab }: { tab: NeglectTab }) {
  // Its face (D25 R), measured on a host the body's size (the full map grows past it when stacked).
  const [faceRef, face] = useWidgetFace()
  return (
    <div ref={faceRef} className={styles.faceHost}>
      {face === 'large' ? <NeglectMapFull tab={tab} /> : <NeglectFace tab={tab} face={face} />}
    </div>
  )
}

const neglectMemo = sharedMemo((
  shown: readonly PersistedTodoItem[],
  ctx: StatsContext,
  staleAfterDays: number,
  dueSoonDays: UrgentDueWithinDays,
  hiddenStatusIds: readonly number[] | undefined,
): NeglectMap<PersistedTodoItem> => buildNeglectMap(shown, { today: ctx.today, staleAfterDays, dueSoonDays, hiddenStatusIds }), 4)

/**
 * Every open task the screen filter keeps, placed on the map (the full
 * map's and its faces'): the glance widgets' shared base (`useStatsBase`),
 * so the tasks are filtered once for all of them, under Settings' Stale
 * after and due-soon range as they are now, the tab's hidden statuses left
 * out.
 */
function useNeglectMap(tab: NeglectTab): NeglectMap<PersistedTodoItem> {
  const base = useStatsBase()
  const dueSoonDays = useSettingsStore((s) => s.urgentDueWithinDays)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  return neglectMemo(base.shown, base.ctx, staleAfterDays, dueSoonDays, tab.config.hiddenStatusIds)
}

/**
 * A zone's Review: always the popup review (never a layout's Review
 * widget), on the zone as an expression with the tab's hidden statuses left
 * out (`neglectZoneReviewFilter`).
 */
function useZoneReview(tab: NeglectTab): (zone: NeglectReviewZone) => void {
  const { hiddenStatusIds } = tab.config
  return useCallback((zone: NeglectReviewZone) => {
    void jumpToPopupReview(neglectZoneReviewFilter(zone, hiddenStatusIds))
  }, [hiddenStatusIds])
}

/**
 * The map's small and medium faces (D25 R). Small: the Slipping count, of
 * the open tasks placed — no 7-day change: what a task's untouched days
 * were a week ago isn't kept (a task touched since has lost its older
 * stamp), so a past Slipping count can't be rebuilt honestly. Medium: the
 * list (Slipping or Forgotten) without the plot.
 */
function NeglectFace({ tab, face }: { tab: NeglectTab; face: Exclude<WidgetFace, 'large'> }) {
  const map = useNeglectMap(tab)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const [listZone, setListZone] = useListZone(map)
  const reviewZone = useZoneReview(tab)
  const slipping = map.slipping.length
  if (face === 'medium') {
    return (
      <div className={`${styles.widget} ${styles.stacked} ${styles.face}`} data-neglect-face="medium" data-neglect-face-tab={tab.id}>
        <ZoneList map={map} zone={listZone} onZone={setListZone} onReview={reviewZone} staleAfterDays={staleAfterDays} />
      </div>
    )
  }
  return (
    <div
      className={styles.smallFace}
      role="group"
      aria-label={`Slipping: ${slipping} of ${map.points.length} open`}
      data-neglect-face="small"
      data-neglect-face-tab={tab.id}
    >
      <span className={styles.smallTitle}>Slipping</span>
      <span className={styles.smallFigures}>
        <span className={styles.smallCount} data-lit={slipping > 0 ? 'true' : undefined} data-testid="neglect-face-count">{slipping}</span>
        <span className={styles.smallCaption}>of {map.points.length} open · {staleAfterDays > 0 ? `${staleAfterDays}d+ untouched` : 'Stale after off'}</span>
      </span>
    </div>
  )
}

/** The full map (its large face). */
function NeglectMapFull({ tab }: { tab: NeglectTab }) {
  const isMobile = useIsMobile()
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const { active: screenActive } = useScreenFilter()
  const chipCount = useFilterStore((s) => screenFilterCount(s.filters))
  const dueSoonDays = useSettingsStore((s) => s.urgentDueWithinDays)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const [sizeRef, size] = useElementSize()
  const [fieldRef, fieldSize] = useElementSize()
  const [stripRef, stripSize] = useElementSize()
  const { colourBy } = tab.config

  const map = useNeglectMap(tab)
  const [listZone, setListZone] = useListZone(map)
  const openTotal = useMemo(() => todos.reduce((n, t) => n + (t.isCompleted ? 0 : 1), 0), [todos])

  // The list: beside a wide plot, under a phone's; a narrower widget has none (its plot fills it).
  const besideList = !isMobile && size.width >= NEGLECT_SIDE_LIST_MIN_PX
  const showList = isMobile || besideList
  // The dots' numbers are the Slipping list's: none without it, or while it shows Forgotten.
  const numbered = showList && listZone === 'slipping'
  const badges = useMemo(
    () => new Map(numbered ? map.slipping.slice(0, SLIPPING_LISTED).map((p, i) => [p.todo.id, i + 1]) : []),
    [map, numbered],
  )

  // Selection rows, in the order the keyboard walks them: the Slipping list's, then the rest.
  const rows = useMemo<ScopedRow[]>(() => {
    const slipping = new Set(map.slipping.map((p) => p.todo.id))
    return [...map.slipping, ...map.points.filter((p) => !slipping.has(p.todo.id))]
      .map((p) => ({ key: rowKey(SECTION, p.todo.id), todoId: p.todo.id }))
  }, [map])
  const { inScope, selectedIds, onSelect } = useWidgetSelection(tab.id, () => rows)

  const activate = useCallback((p: NeglectPoint<PersistedTodoItem>, mods: { shift: boolean; ctrl: boolean }) => {
    if (!isMobile && (mods.ctrl || mods.shift)) onSelect(rowKey(SECTION, p.todo.id), p.todo.id, { shift: false, ctrl: true })
    else openEditPopup(p.todo.id)
  }, [isMobile, onSelect, openEditPopup])

  const lassoSelect = useCallback((ids: number[], additive: boolean) => {
    const ui = useUIStore.getState()
    const mine = ui.selectionScope === tab.id
    const next = new Set(additive && mine ? ui.selectedTodoIds : [])
    for (const id of ids) next.add(id)
    const first = ids.at(0) ?? [...next].at(0)
    if (first == null) {
      if (mine) ui.clearSelection()
      return
    }
    const key = rowKey(SECTION, first)
    ui.setScopedSelection(tab.id, { ids: next, anchorKey: key, cursorKey: key, cursorTodoId: first })
  }, [tab.id])
  const { boxRef: lassoRef, handlers } = useLasso(!isMobile, lassoSelect)

  const screenHidesAll = map.points.length === 0 && openTotal > 0 && screenActive
  const unhide = screenUnhideAction(chipCount)
  // Stale after's line, the Slipping corner and the Forgotten part: while it is on and short of the cap.
  const staleLine = staleLineShown(staleAfterDays)
  const threshold = xPct(staleAfterDays)
  // The Slipping corner: from the top down to the due-soon line (today when the range is off).
  const nearEdge = yPct(dueSoonDays != null ? Math.min(NEGLECT_Y_MAX, dueSoonDays) : 0)
  const forgottenStart = threshold
  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2

  const dotFor = (p: NeglectPoint<PersistedTodoItem>) => (
    <Dot
      key={p.todo.id}
      point={p}
      colour={neglectDotColour(colourBy, assignedTagsMap.get(p.todo.id), assignedPeopleMap.get(p.todo.id))}
      marked={p.todo.urgent === true || p.todo.important === true || p.todo.focus === true}
      followupLate={isFollowupOverdue(p.todo, today)}
      badge={badges.get(p.todo.id) ?? null}
      selected={inScope && selectedIds.has(p.todo.id)}
      onActivate={activate}
      selectable={!isMobile}
    />
  )
  const plotted = useMemo(() => map.points.filter((p) => p.dateIn != null), [map])
  const strip = useMemo(() => map.points.filter((p) => p.dateIn == null), [map])
  const noDueCount = map.counts.noDates + map.counts.forgotten
  /** A zone's word pressed: its tasks as a list (the task dialog) — the strip's `No dates` every task in it. */
  const openZone = useCallback((zone: NeglectZone) => {
    const inZone = zone === 'slipping' ? map.slipping
      : map.points.filter((p) => (zone === 'noDates' ? p.dateIn == null : p.zone === zone))
        // Soonest due first (the latest of the late ones on top), then the longest untouched.
        .sort((a, b) => (a.dateIn ?? 0) - (b.dateIn ?? 0) || b.untouched - a.untouched)
    useUIStore.getState().showTaskDialog(neglectZoneDrill(zone, inZone.map((p) => p.todo.id), staleAfterDays))
  }, [map, staleAfterDays])
  const zoneText = (zone: NeglectZone) => `${ZONE_NAMES[zone]} ${map.counts[zone]}`
  const reviewZone = useZoneReview(tab)

  // The names that fit beside their dots (`placeNeglectLabels`): the Slipping tasks first, in their list's
  // order, then the flagged ones, then the rest — on the plot and on the strip, each in its own field.
  const { plotLabels, stripLabels } = useMemo(() => {
    const rank = new Map(map.slipping.map((p, i) => [p.todo.id, i]))
    const flagged = (p: NeglectPoint<PersistedTodoItem>) => p.todo.urgent === true || p.todo.important === true || p.todo.focus === true
    const order = (a: NeglectPoint<PersistedTodoItem>, b: NeglectPoint<PersistedTodoItem>) =>
      (rank.get(a.todo.id) ?? Infinity) - (rank.get(b.todo.id) ?? Infinity) || Number(flagged(b)) - Number(flagged(a))
    const dotsOf = (points: readonly NeglectPoint<PersistedTodoItem>[], w: number, h: number, noDue: boolean): LabelDot[] =>
      [...points].sort(order).map((p) => ({
        id: p.todo.id,
        x: (xPct(p.x) / 100) * w,
        y: ((noDue ? stripPct(p.y) : yPct(p.y)) / 100) * h,
        radius: dotRadius(flagged(p), isFollowupOverdue(p.todo, today)),
        textWidth: appTextWidth(p.todo.title, LABEL_FONT_PX, LABEL_FONT_WEIGHT),
        ...(badges.has(p.todo.id) ? { badge: { side: p.x > BADGE_FLIP_X ? 'left' as const : 'right' as const, width: BADGE_PX, height: BADGE_PX } } : {}),
      }))
    const { width: fw, height: fh } = fieldSize
    const { width: sw, height: sh } = stripSize
    const noDueCount = map.counts.noDates + map.counts.forgotten
    const word = (zone: NeglectZone) => `${ZONE_NAMES[zone]} ${map.counts[zone]}`
    // A reviewable zone's word has its Review button beside it while it holds any task.
    const review = (zone: NeglectReviewZone) => (map.counts[zone] > 0 ? ZONE_REVIEW_PX : 0)
    return {
      plotLabels: placeNeglectLabels(dotsOf(plotted, fw, fh, false), fieldSize, [
        wordRect(word('inHand'), 'top-left', fw, fh), wordRect(word('slipping'), 'top-right', fw, fh, 0, review('slipping')),
        wordRect(word('later'), 'bottom-left', fw, fh), wordRect(word('drifting'), 'bottom-right', fw, fh, 0, review('drifting')),
      ]),
      stripLabels: placeNeglectLabels(dotsOf(strip, sw, sh, true), stripSize, [
        wordRect(`No dates · ${noDueCount}`, 'top-left', sw, sh, 3), wordRect(`Forgotten · ${map.counts.forgotten}`, 'top-right', sw, sh, 3, review('forgotten')),
      ]),
    }
  }, [map, plotted, strip, badges, today, fieldSize, stripSize])

  // The axes span the field: `+Nd` and `30d` give way where their labels would crowd a neighbour's (unmeasured, all show).
  const yAll = yMarks(dueSoonDays)
  const shownYMarks = fieldSize.height > 0
    ? uncrowdedMarks(yAll.map((m) => ({ ...m, ...markSpan(m.key, (yPct(m.y) / 100) * fieldSize.height, MARK_FONT_PX) })), 'soon')
    : yAll
  const xAll = xMarks(staleAfterDays)
  const shownXMarks = fieldSize.width > 0
    ? uncrowdedMarks(xAll.map((m) => ({ ...m, ...markSpan(m.key, (xPct(m.x) / 100) * fieldSize.width, appTextWidth(m.label, MARK_FONT_PX)) })), 'mid')
    : xAll

  return (
    <>
    {/* Alone in its cell, its top line (D26 AA1): its name (Slipping's count is its corner's word). */}
    <WidgetNameLine name="Neglect map" />
    <div
      ref={sizeRef}
      // A phone stacks the plot (scaled to its width) over the list; elsewhere the plot fills the widget, beside the list when there is one.
      className={`${styles.widget} ${isMobile ? `${styles.stacked} ${styles.touch}` : styles.beside}`}
      data-neglect-map={tab.id}
      data-layout={isMobile ? 'stacked' : 'beside'}
      data-slipping-list={showList ? 'true' : undefined}
      {...{ [SELECTION_SCOPE_ATTR]: isMobile ? undefined : tab.id }}
    >
      <div className={styles.chart} data-neglect-chart="" {...handlers}>
        <div className={styles.yAxis} aria-hidden="true">
          {shownYMarks.map((m) => (
            <span key={m.key} className={styles.yMark} data-mark={m.key} style={{ top: `${yPct(m.y)}%` }}>{m.label}</span>
          ))}
        </div>
        <div className={styles.plot} role="group" aria-label="Neglect map: days until due or follow-up by days untouched">
          <div ref={fieldRef} className={styles.field}>
            {staleLine && (
              <div
                className={styles.slippingCorner}
                style={{ left: `${threshold}%`, height: `calc(${nearEdge}% + var(--neglect-inset))` }}
                data-testid="neglect-slipping-corner"
                aria-hidden="true"
              />
            )}
            <div className={styles.todayLine} style={{ top: `${yPct(0)}%` }} aria-hidden="true" />
            {dueSoonDays != null && dueSoonDays > 0 && (
              <div className={styles.soonLine} style={{ top: `${nearEdge}%` }} aria-hidden="true" data-testid="neglect-soon-line" />
            )}
            {staleLine && <div className={styles.untouchedLine} style={{ left: `${threshold}%` }} aria-hidden="true" />}
            <ZoneWithReview zone="slipping" text={zoneText('slipping')} count={map.counts.slipping} className={`${styles.corner} ${styles.cornerSlipping}`} onOpen={openZone} onReview={reviewZone} />
            <ZoneWord zone="inHand" text={zoneText('inHand')} count={map.counts.inHand} className={`${styles.corner} ${styles.cornerInHand}`} onOpen={openZone} />
            <ZoneWord zone="later" text={zoneText('later')} count={map.counts.later} className={`${styles.corner} ${styles.cornerLater}`} onOpen={openZone} />
            <ZoneWithReview zone="drifting" text={zoneText('drifting')} count={map.counts.drifting} className={`${styles.corner} ${styles.cornerDrifting}`} onOpen={openZone} onReview={reviewZone} />
            {plotted.map(dotFor)}
            {plotted.map((p) => {
              const label = plotLabels.get(p.todo.id)
              return label ? <DotLabel key={p.todo.id} point={p} label={label} noDue={false} /> : null
            })}
          </div>
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {shownXMarks.map((m) => (
            <span key={m.key} className={styles.xMark} data-mark={m.key} style={{ left: `${xPct(m.x)}%` }}>{m.label}</span>
          ))}
        </div>
        <div className={styles.strip} role="group" aria-label={`No dates: ${noDueCount}`}>
          <div ref={stripRef} className={styles.stripField}>
            {staleLine && <div className={styles.forgottenPart} style={{ left: `${forgottenStart}%` }} aria-hidden="true" />}
            <ZoneWord zone="noDates" text={`No dates · ${noDueCount}`} count={noDueCount} className={styles.stripLabel ?? ''} onOpen={openZone} />
            <ZoneWithReview zone="forgotten" text={`Forgotten · ${map.counts.forgotten}`} count={map.counts.forgotten} className={styles.forgottenLabel ?? ''} onOpen={openZone} onReview={reviewZone} testId="neglect-forgotten" />
            {strip.map(dotFor)}
            {strip.map((p) => {
              const label = stripLabels.get(p.todo.id)
              return label ? <DotLabel key={p.todo.id} point={p} label={label} noDue /> : null
            })}
          </div>
        </div>
        <LassoBox ref={lassoRef} />
        {screenHidesAll && (
          <div className={styles.notePanel} role="status">
            <span className={styles.noteTitle}>No tasks match</span>
            <span className={styles.noteHint}>
              All {openTotal} open {openTotal === 1 ? 'task is' : 'tasks are'} hidden by the screen filter.
            </span>
            <button type="button" className={styles.noteAction} onClick={unhide.onClick}>{unhide.label}</button>
          </div>
        )}
      </div>

      {showList && (
        <ZoneList
          map={map}
          zone={listZone}
          onZone={setListZone}
          onReview={reviewZone}
          staleAfterDays={staleAfterDays}
          selectedIds={inScope ? selectedIds : undefined}
        />
      )}
    </div>
    {/* Docked at the foot, after the map (the face host is a column): it covers no dot. */}
    {showBulkBar && <ListBulkBar ids={[...selectedIds]} />}
    </>
  )
}

/** The two lists the map's list switches between. */
type ListZone = 'slipping' | 'forgotten'

/**
 * Which list the map shows: the one picked on its switch, else Slipping —
 * Forgotten while nothing is slipping and something is forgotten. Not
 * saved: the tab has no view state.
 */
function useListZone(map: NeglectMap<PersistedTodoItem>): [ListZone, (zone: ListZone) => void] {
  const [picked, setPicked] = useState<ListZone | null>(null)
  const zone = picked ?? (map.slipping.length === 0 && map.forgotten.length > 0 ? 'forgotten' : 'slipping')
  return [zone, setPicked]
}

/**
 * The map's list: a `Slipping N | Forgotten N` switch over it with the
 * shown zone's Review at its end (while it holds any task), then the
 * shown zone's first `SLIPPING_LISTED` tasks (each opens its task) — the
 * Slipping ones numbered as their dots are badged, the Forgotten ones with
 * a yellow dot —, the rest in the task dialog. The full map's own list, and
 * its medium face (D25 R) alone.
 */
function ZoneList({ map, zone, onZone, onReview, staleAfterDays, selectedIds }: {
  map: NeglectMap<PersistedTodoItem>
  zone: ListZone
  onZone: (zone: ListZone) => void
  onReview: (zone: NeglectReviewZone) => void
  /** Settings' Stale after (the task dialog's description). */
  staleAfterDays: number
  /** The widget's selection, while it owns it (the full map's). */
  selectedIds?: ReadonlySet<number>
}) {
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const points = map[zone]
  const listed = points.slice(0, SLIPPING_LISTED)
  const showMore = points.length > listed.length
  const segment = (z: ListZone) => (
    <button
      type="button"
      className={styles.listSegment}
      aria-pressed={zone === z}
      data-list-zone={z}
      onClick={() => onZone(z)}
    >
      <span className={styles.slipTitle}>{ZONE_NAMES[z]}</span>
      <span className={styles.slipCount} data-testid={`neglect-${z}-count`}>{map[z].length}</span>
    </button>
  )
  return (
    <section className={styles.slipping} aria-label={ZONE_NAMES[zone]} data-list-zone={zone}>
      <header className={styles.slipHead}>
        <span className={styles.listSwitch} role="group" aria-label="List">
          {segment('slipping')}
          {segment('forgotten')}
        </span>
        {points.length > 0 && <ZoneReviewButton zone={zone} count={points.length} onReview={onReview} labeled />}
      </header>
      {points.length === 0 ? (
        <p className={styles.slipEmpty}>
          {zone === 'slipping' ? 'Nothing slipping.' : 'Nothing forgotten.'}
        </p>
      ) : (
        <ol className={styles.slipList}>
          {listed.map((p, i) => (
            <li key={p.todo.id}>
              <button
                type="button"
                className={styles.slipRow}
                data-selected={selectedIds?.has(p.todo.id) ? 'true' : undefined}
                {...{ [TODO_ID_ATTR]: p.todo.id }}
                onClick={() => openEditPopup(p.todo.id)}
              >
                {zone === 'slipping'
                  ? <span className={styles.slipBadge} aria-hidden="true">{i + 1}</span>
                  : <span className={styles.forgottenDot} aria-hidden="true" />}
                <span className={styles.slipText}>
                  <span className={styles.slipName}>{p.todo.title}</span>
                  <span className={styles.slipMeta}>{dateInText(p.dateIn, p.dateBy)} · {untouchedText(p.untouched)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {showMore && (
        <button
          type="button"
          className={styles.slipMore}
          onClick={() => useUIStore.getState().showTaskDialog(
            neglectZoneDrill(zone, points.map((p) => p.todo.id), staleAfterDays),
          )}
        >
          {points.length - listed.length} more
        </button>
      )}
    </section>
  )
}
