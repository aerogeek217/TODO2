import { useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { NeglectTab } from '../../../models/workspace-layout'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../../constants'
import { useElementSize } from '../../../hooks/use-element-size'
import { useFilterSettings } from '../../../hooks/use-filter-settings'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useToday } from '../../../hooks/use-today'
import { useTodoNameLookups } from '../../../hooks/use-todo-name-lookups'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import { slippingTasksDialog } from '../../../services/task-dialog'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useAppliedLens, useScreenFilter } from '../../../stores/screen-filter'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { ROW_KEY_ATTR, ROW_TODO_ATTR, SELECTION_SCOPE_ATTR, TODO_ID_ATTR } from '../../../utils/dom-contract'
import { countActiveFilters } from '../../../utils/filter-criteria'
import { applyFilter } from '../../../utils/filter-match'
import { isFollowupOverdue } from '../../../utils/followup'
import {
  buildNeglectMap,
  dueInText,
  NEGLECT_X_CAP,
  NEGLECT_Y_MAX,
  NEGLECT_Y_MIN,
  neglectDotColour,
  untouchedText,
  type NeglectPoint,
  type NeglectZone,
} from '../../../utils/neglect-map'
import { rowKey, type ScopedRow } from '../../../utils/scoped-selection'
import { screenHiderText, screenUnhideAction } from '../../shared/filters/screen-hides'
import { useTooltip } from '../../shared/use-tooltip'
import { ListBulkBar } from '../list/ListBulkBar'
import styles from './NeglectMapWidget.module.css'

/** At this width and wider the Slipping list sits beside the plot; narrower (and on phones) under it. */
export const NEGLECT_SIDE_LIST_MIN_PX = 640

/** The Slipping list numbers this many tasks (and badges their dots); the rest open in the task dialog. */
export const SLIPPING_LISTED = 9

/** The section key of the map's dots in the selection (`rowKey`). */
const SECTION = 'map'

const ZONE_NAMES: Record<NeglectZone, string> = {
  slipping: 'Slipping',
  inHand: 'In hand',
  planned: 'Planned',
  drifting: 'Drifting',
  forgotten: 'Forgotten',
  noDue: 'No due date',
}

/** Days untouched past which a dot's badge sits on its left (it would leave the plot on the right). */
const BADGE_FLIP_X = 54

/** Days untouched as a place across the plot, a percentage. */
const xPct = (x: number) => (x / NEGLECT_X_CAP) * 100
/** A due-in value's place down the plot, as a percentage (late at the top). */
const yPct = (y: number) => ((y - NEGLECT_Y_MIN) / (NEGLECT_Y_MAX - NEGLECT_Y_MIN)) * 100
/** A strip place (0 – 1) down the strip, as a percentage: under its labels, in its lower part. */
const stripPct = (y: number) => 70 + (y - 0.5) * 30

/** What a dot says (its label and tooltip lines). */
function pointLines(p: NeglectPoint<PersistedTodoItem>, followupLate: boolean): [string, string] {
  const meta = [dueInText(p.dueIn), untouchedText(p.untouched), ...(followupLate ? ['follow-up late'] : [])].join(' · ')
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

function Dot({ point, colour, marked, followupLate, badge, selected, onActivate, selectable }: DotProps) {
  const [title, meta] = pointLines(point, followupLate)
  const { triggerProps, tooltip } = useTooltip(`${title}\n${meta}`)
  const noDue = point.dueIn == null
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
}

/** The rectangle a lasso drag covers, in the chart's own px. */
interface Lasso {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Lasso selection over the chart: a drag that starts on empty plot (not on
 * a dot) draws a rectangle; on release the dots inside it are the widget's
 * selection (Ctrl / ⌘ / Shift add to it). A drag that catches none clears
 * the widget's selection, as a click outside the rows does.
 */
function useLasso(enabled: boolean, onSelect: (ids: number[], additive: boolean) => void) {
  const [lasso, setLasso] = useState<Lasso | null>(null)
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0 || !(e.target instanceof Element)) return
    if (e.target.closest('[data-neglect-dot]')) return
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
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
    if (!lasso && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_ACTIVATION_DISTANCE_PX) return
    setLasso(rectOf(e.currentTarget, e, start))
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = startRef.current
    startRef.current = null
    if (!start || start.id !== e.pointerId) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!lasso) return
    setLasso(null)
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
    lasso,
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

/**
 * `0d` · the threshold · `30d` · `60d+ untouched`: the x axis's marks (the
 * threshold's replaces a mark it would crowd).
 */
function xMarks(untouchedDays: number): Array<{ x: number; label: string; key: string }> {
  const marks = [{ x: 0, label: '0d', key: 'zero' }, { x: untouchedDays, label: `${untouchedDays}d`, key: 'threshold' }]
  if (Math.abs(untouchedDays - 30) > 6) marks.push({ x: 30, label: '30d', key: 'mid' })
  marks.push({ x: NEGLECT_X_CAP, label: `${NEGLECT_X_CAP}d+ untouched`, key: 'cap' })
  return marks
}

/**
 * The Neglect map widget (D25 board H): every open task the screen filter
 * (chips and lens) keeps, as a dot placed by how long it has gone untouched
 * (across, capped at 60 days) and how soon it is due (down: 14 days late at
 * the top, today, the due-soon line, 30 days ahead at the bottom; tasks
 * without a due date in the strip under it). The top-right corner —
 * due soon or late and untouched for the tab's threshold — is Slipping,
 * listed beside the plot (under it when narrow). A dot's colour is the
 * tab's Colour by (a picked tag's, the first person's, or neutral); a
 * priority flag makes it larger, a late follow-up rings it yellow. A click
 * opens the task; a drag on empty plot lassoes dots into the widget's
 * selection, which the bulk bar acts on.
 */
export function NeglectMapWidget({ tab }: { tab: NeglectTab }) {
  const isMobile = useIsMobile()
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const lookups = useTodoNameLookups()
  const { filters: screen, active: screenActive } = useScreenFilter()
  const lens = useAppliedLens()
  const chipCount = useFilterStore((s) => countActiveFilters(s.filters))
  const markerSettings = useFilterSettings()
  const dueSoonDays = useSettingsStore((s) => s.urgentDueWithinDays)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const [sizeRef, size] = useElementSize()
  const { untouchedDays, colourBy } = tab.config

  const shown = useMemo(
    () => applyFilter(screen, todos, lookups, today, markerSettings),
    [screen, todos, lookups, today, markerSettings],
  )
  const map = useMemo(() => buildNeglectMap(shown, { today, untouchedDays, dueSoonDays }), [shown, today, untouchedDays, dueSoonDays])
  const openTotal = useMemo(() => todos.reduce((n, t) => n + (t.isCompleted ? 0 : 1), 0), [todos])

  const listed = useMemo(() => map.slipping.slice(0, SLIPPING_LISTED), [map])
  const badges = useMemo(() => new Map(listed.map((p, i) => [p.todo.id, i + 1])), [listed])

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
  const { lasso, handlers } = useLasso(!isMobile, lassoSelect)

  const besideList = !isMobile && size.width >= NEGLECT_SIDE_LIST_MIN_PX
  const screenHidesAll = map.points.length === 0 && openTotal > 0 && screenActive
  const unhide = screenUnhideAction(chipCount)
  const threshold = xPct(untouchedDays)
  // The Slipping corner: from the top down to the due-soon line (today when the range is off).
  const nearEdge = yPct(dueSoonDays != null ? Math.min(NEGLECT_Y_MAX, dueSoonDays) : 0)
  const forgottenStart = threshold
  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2
  const showMore = map.slipping.length > listed.length

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
  const plotted = map.points.filter((p) => p.dueIn != null)
  const strip = map.points.filter((p) => p.dueIn == null)

  return (
    <div
      ref={sizeRef}
      className={`${styles.widget} ${besideList ? styles.beside : styles.stacked} ${isMobile ? styles.touch : ''}`}
      data-neglect-map={tab.id}
      data-layout={besideList ? 'beside' : 'stacked'}
      {...{ [SELECTION_SCOPE_ATTR]: isMobile ? undefined : tab.id }}
    >
      <div className={styles.chart} data-neglect-chart="" {...handlers}>
        <div className={styles.yAxis} aria-hidden="true">
          {yMarks(dueSoonDays).map((m) => (
            <span key={m.key} className={styles.yMark} data-mark={m.key} style={{ top: `${yPct(m.y)}%` }}>{m.label}</span>
          ))}
        </div>
        <div className={styles.plot} role="group" aria-label="Neglect map: days until due by days untouched">
          <div className={styles.field}>
            <div
              className={styles.slippingCorner}
              style={{ left: `${threshold}%`, height: `calc(${nearEdge}% + var(--neglect-inset))` }}
              data-testid="neglect-slipping-corner"
              aria-hidden="true"
            />
            <div className={styles.todayLine} style={{ top: `${yPct(0)}%` }} aria-hidden="true" />
            {dueSoonDays != null && dueSoonDays > 0 && (
              <div className={styles.soonLine} style={{ top: `${nearEdge}%` }} aria-hidden="true" data-testid="neglect-soon-line" />
            )}
            <div className={styles.untouchedLine} style={{ left: `${threshold}%` }} aria-hidden="true" />
            <span className={`${styles.corner} ${styles.cornerSlipping}`} aria-hidden="true">Slipping</span>
            <span className={`${styles.corner} ${styles.cornerInHand}`} aria-hidden="true">In hand</span>
            <span className={`${styles.corner} ${styles.cornerPlanned}`} aria-hidden="true">Planned</span>
            <span className={`${styles.corner} ${styles.cornerDrifting}`} aria-hidden="true">Drifting</span>
            {plotted.map(dotFor)}
          </div>
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {xMarks(untouchedDays).map((m) => (
            <span key={m.key} className={styles.xMark} data-mark={m.key} style={{ left: `${xPct(m.x)}%` }}>{m.label}</span>
          ))}
        </div>
        <div className={styles.strip} role="group" aria-label={`No due date: ${map.counts.noDue + map.counts.forgotten}`}>
          <div className={styles.stripField}>
            <div className={styles.forgottenPart} style={{ left: `${forgottenStart}%` }} aria-hidden="true" />
            <span className={styles.stripLabel} aria-hidden="true">No due date · {map.counts.noDue + map.counts.forgotten}</span>
            <span className={styles.forgottenLabel} aria-hidden="true" data-testid="neglect-forgotten">Forgotten · {map.counts.forgotten}</span>
            {strip.map(dotFor)}
          </div>
        </div>
        {lasso && (
          <div
            className={styles.lasso}
            style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }}
            aria-hidden="true"
            data-testid="neglect-lasso"
          />
        )}
        {screenHidesAll && (
          <div className={styles.notePanel} role="status">
            <span className={styles.noteTitle}>No tasks match</span>
            <span className={styles.noteHint}>
              All {openTotal} open {openTotal === 1 ? 'task is' : 'tasks are'} hidden by {screenHiderText(chipCount > 0, lens)}.
            </span>
            <button type="button" className={styles.noteAction} onClick={unhide.onClick}>{unhide.label}</button>
          </div>
        )}
      </div>

      <section className={styles.slipping} aria-label="Slipping">
        <header className={styles.slipHead}>
          <span className={styles.slipTitle}>Slipping</span>
          <span className={styles.slipCount} data-testid="neglect-slipping-count">{map.slipping.length}</span>
        </header>
        {map.slipping.length === 0 ? (
          <p className={styles.slipEmpty}>
            Nothing slipping: every task due soon or late was touched in the last {untouchedDays} days.
          </p>
        ) : (
          <ol className={styles.slipList}>
            {listed.map((p, i) => (
              <li key={p.todo.id}>
                <button
                  type="button"
                  className={styles.slipRow}
                  data-selected={inScope && selectedIds.has(p.todo.id) ? 'true' : undefined}
                  {...{ [TODO_ID_ATTR]: p.todo.id }}
                  onClick={() => openEditPopup(p.todo.id)}
                >
                  <span className={styles.slipBadge} aria-hidden="true">{i + 1}</span>
                  <span className={styles.slipText}>
                    <span className={styles.slipName}>{p.todo.title}</span>
                    <span className={styles.slipMeta}>{dueInText(p.dueIn)} · {untouchedText(p.untouched)}</span>
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
            onClick={() => useUIStore.getState().showTaskDialog({
              ...slippingTasksDialog(map.slipping.map((p) => p.todo.id), untouchedDays),
              fromTabId: tab.id,
            })}
          >
            {map.slipping.length - listed.length} more
          </button>
        )}
      </section>
      {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={12} />}
    </div>
  )
}
