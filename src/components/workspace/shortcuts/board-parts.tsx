import { memo, type CSSProperties } from 'react'
import type { PersistedTodoItem } from '../../../models'
import { useUIStore } from '../../../stores/ui-store'
import { TODO_ID_ATTR } from '../../../utils/dom-contract'
import { WALL_TONE_NAMES, WALL_TONES, wallSquaresShown, type WallList, type WallMarkers, type WallTone } from '../../../utils/list-wall'
import { PriorityRing } from '../../shared/PriorityRing'
import { useTooltip } from '../../shared/use-tooltip'
import styles from './ShortcutsWidget.module.css'

/**
 * A List board tile's marks (`utils/list-wall`): a square per open task the
 * list shows, its state the fill and its priority a ring; the segment bar of
 * a row.
 */

type Wall = WallList<PersistedTodoItem>

/** A square's side and corner, px (the stylesheet's `.square`). */
const SQUARE_PX = 10
const SQUARE_CORNER_PX = 2

/** A tile's squares: `rows` whole rows of `columns`, the trouble first; cut, the last three give way to `+N`. */
export function BoardSquares({ wall, columns, rows }: { wall: Wall; columns: number; rows: number }) {
  if (rows <= 0 || wall.squares.length === 0) return null
  const { squares, more } = wallSquaresShown(wall, { columns, rows })
  return (
    <span className={styles.squares} role="group" aria-label={`${wall.name}: its tasks`} style={{ '--board-columns': columns } as CSSProperties} data-board-squares="">
      {squares.map((sq) => <Square key={sq.task.id} task={sq.task} tone={sq.tone} markers={sq.markers} />)}
      {more > 0 && <span className={styles.squaresMore} aria-label={`${more} more`} data-board-more="">+{more}</span>}
    </span>
  )
}

/** A task's square: its state the fill, its priority a ring and Focus's glow (`PriorityRing`, as on the task's checkbox); its tooltip its title, state and priority; a click opens it. */
function Square({ task, tone, markers }: { task: PersistedTodoItem; tone: WallTone; markers: WallMarkers | undefined }) {
  return (
    <SquareButton
      task={task}
      tone={tone}
      focus={markers?.focus ?? false}
      urgent={markers?.urgent ?? null}
      important={markers?.important ?? false}
      priority={markers?.label ?? null}
    />
  )
}

/** Memoized on plain props: the markers' object is new on every build of the tile. */
const SquareButton = memo(function SquareButton({ task, tone, focus, urgent, important, priority }: {
  task: PersistedTodoItem
  tone: WallTone
  focus: boolean
  urgent: WallMarkers['urgent']
  important: boolean
  /** `Priority: Focus, Urgent` — null with no priority. */
  priority: string | null
}) {
  const state = WALL_TONE_NAMES[tone]
  const hasPriority = focus || urgent !== null || important
  const words = hasPriority && priority ? `${state} · ${priority}` : state
  const { triggerProps, tooltip } = useTooltip(`${task.title}\n${words}`)
  return (
    <button
      type="button"
      className={styles.square}
      data-tone={tone}
      aria-label={`${task.title}: ${words}`}
      {...{ [TODO_ID_ATTR]: task.id }}
      {...triggerProps}
      onClick={() => useUIStore.getState().openEditPopup(task.id)}
    >
      {hasPriority && (
        <PriorityRing summary={{ focus, urgent, important }} completed={false} size={SQUARE_PX} corner={SQUARE_CORNER_PX} />
      )}
      {tooltip}
    </button>
  )
})

/** A row's bar: the list's open tasks by state, each a segment as long as its share; dashed while it waits on its prompt. */
export function BoardBar({ wall }: { wall: Wall }) {
  if (wall.waiting) return <span className={styles.barWaiting} aria-hidden="true" />
  return (
    <span className={styles.barTrack} aria-hidden="true" data-board-bar="">
      {WALL_TONES.filter((t) => wall.counts[t] > 0).map((t) => (
        <span key={t} className={styles.segment} data-tone={t} style={{ flexGrow: wall.counts[t] }} />
      ))}
    </span>
  )
}
