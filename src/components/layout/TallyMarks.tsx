import { useLayoutEffect, useState, type RefObject } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useDoneToday } from '../../hooks/use-done-today'
import { TALLY_HEIGHT_PX, tallyLabel, tallyLayout, tallyMarks, tasksDoneToday } from '../../utils/tally'
import { useTooltip } from '../shared/use-tooltip'
import styles from './TallyMarks.module.css'

/** The tally's least distance from the tray and from the right zone, px. */
const TALLY_GAP_PX = 10

/** The free stretch of bar between the tray and the right zone, bar-relative px. */
interface Gap {
  left: number
  room: number
}

/**
 * The gap between the tray's right edge and the right zone's left edge,
 * measured after each resize of the bar, the tray, its parts, the centring
 * gap (it moves the tray) or the right zone, on the next frame. Set up once
 * while enabled (not on every render of the bar).
 */
function useTallyGap(
  enabled: boolean,
  barRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLElement | null>,
  trayRef: RefObject<HTMLElement | null>,
  rightRef: RefObject<HTMLElement | null>,
): Gap | null {
  const [gap, setGap] = useState<Gap | null>(null)
  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return
    let frame = 0
    // The parts are watched as they appear: on the first mount the bar's own
    // ref is attached only after this (a child's) layout effect.
    const watched = new Set<Element>()
    const watch = () => {
      const parts = [barRef.current, spacerRef.current, trayRef.current, rightRef.current, ...Array.from(trayRef.current?.children ?? [])]
      for (const el of parts) if (el && !watched.has(el)) { watched.add(el); observer.observe(el) }
    }
    const measure = () => {
      frame = 0
      watch()
      const bar = barRef.current
      const tray = trayRef.current
      const right = rightRef.current
      if (!bar || !tray || !right) return
      const barLeft = bar.getBoundingClientRect().left
      const trayRight = tray.getBoundingClientRect().right
      const rightLeft = right.getBoundingClientRect().left
      const left = Math.round(trayRight - barLeft + TALLY_GAP_PX)
      const room = Math.max(0, Math.floor(rightLeft - trayRight - 2 * TALLY_GAP_PX))
      setGap((shown) => (shown && shown.left === left && shown.room === room ? shown : { left, room }))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    watch()
    schedule()
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
    // Once per switch on: the refs are stable, and `measure` watches parts attached later.
  }, [enabled, barRef, spacerRef, trayRef, rightRef])
  return enabled ? gap : null
}

/**
 * The tally of tasks finished today (flair P3, board 12b): scratched marks
 * in the top bar's free stretch right of the filter tray, four strokes then
 * a slash. An absolute layer, so the bar's fold and centring never see it.
 * The newest whole groups that fit show; with no room for one, nothing. Off
 * in Settings › Appearance › Theme (`tallyMarks`). A click lists today's
 * tasks in the task dialog (`showDoneToday`).
 */
export function TallyMarks({ barRef, spacerRef, trayRef, rightRef }: {
  barRef: RefObject<HTMLElement | null>
  spacerRef: RefObject<HTMLElement | null>
  trayRef: RefObject<HTMLElement | null>
  rightRef: RefObject<HTMLElement | null>
}) {
  const on = useSettingsStore((s) => s.tallyMarks)
  const count = useDoneToday()
  const gap = useTallyGap(on && count > 0, barRef, spacerRef, trayRef, rightRef)
  if (!gap || count <= 0) return null
  return <TallyWall count={count} left={gap.left} room={gap.room} />
}

/** The task dialog of the tasks completed today, the last first (the tally's click). */
function showDoneToday(): void {
  const ids = tasksDoneToday(useTodoStore.getState().todos, new Date()).map((t) => t.id)
  useUIStore.getState().showTaskDialog({
    title: 'Done today',
    glyph: 'done',
    description: 'The tasks you completed today.',
    source: { kind: 'todos', todoIds: ids },
  })
}

/**
 * The marks themselves. The newest mark scratches itself in only when the
 * count rises while this is mounted — never on load, never when the setting
 * or the room brings the wall back; a mark that goes (undo, reopen, a
 * delete) goes at once.
 */
function TallyWall({ count, left, room }: { count: number; left: number; room: number }) {
  // The last count seen, and the mark that arrived with it (derived state, no effect).
  const [seen, setSeen] = useState<{ count: number; fresh: number | null }>({ count, fresh: null })
  let current = seen
  if (count !== seen.count) {
    current = { count, fresh: count > seen.count ? count - 1 : null }
    setSeen(current)
  }
  const layout = tallyLayout(count, room)
  if (layout.width === 0) return null
  const label = tallyLabel(count)
  const width = Math.ceil(layout.width) + 1
  return <TallyButton label={label} left={left} width={width} layout={layout} fresh={current.fresh} />
}

function TallyButton({ label, left, width, layout, fresh }: {
  label: string
  left: number
  width: number
  layout: ReturnType<typeof tallyLayout>
  fresh: number | null
}) {
  const { triggerProps, tooltip } = useTooltip(`${label} · click to see them`)
  return (
    <button
      type="button"
      className={styles.tally}
      style={{ left }}
      data-tally=""
      aria-label={`${label}. Show them`}
      onClick={showDoneToday}
      {...triggerProps}
    >
      <svg
        className={styles.marks}
        width={width}
        height={TALLY_HEIGHT_PX}
        viewBox={`0 0 ${width} ${TALLY_HEIGHT_PX}`}
        aria-hidden="true"
      >
        {tallyMarks(layout).map((mark) => (
          <path
            key={mark.index}
            d={mark.path}
            transform={mark.x ? `translate(${mark.x} 0)` : undefined}
            pathLength={1}
            className={mark.index === fresh ? styles.fresh : undefined}
          />
        ))}
      </svg>
      {tooltip}
    </button>
  )
}
