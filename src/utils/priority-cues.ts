import { MARKER_KEYS, type MarkerKey } from '../models/filter-predicate'
import type { TodoItem } from '../models/todo-item'
import { MARKER_COLOR } from './markers'
import { urgentMark, type UrgentDueWithinDays } from './urgency'

/**
 * What a priority adds to a task's row beside its dot (Settings › Tasks): a
 * glow from the row's left edge, and a semibold title. Several glowing
 * priorities blend into each other along the row.
 */
export interface PriorityCue {
  glow: boolean
  semibold: boolean
}

export type PriorityCues = Record<MarkerKey, PriorityCue>

export const DEFAULT_PRIORITY_CUES: PriorityCues = {
  focus: { glow: false, semibold: false },
  urgent: { glow: true, semibold: false },
  important: { glow: true, semibold: true },
}

/** Stored JSON → cues; `undefined` when it isn't exactly each priority's two switches. */
export function parsePriorityCues(value: unknown): PriorityCues | undefined {
  if (typeof value !== 'string') return undefined
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const out = {} as PriorityCues
  for (const key of MARKER_KEYS) {
    const cue = (raw as Record<string, unknown>)[key]
    if (typeof cue !== 'object' || cue === null) return undefined
    const { glow, semibold } = cue as Record<string, unknown>
    if (typeof glow !== 'boolean' || typeof semibold !== 'boolean') return undefined
    out[key] = { glow, semibold }
  }
  return out
}

/** A glow's colour: the marker's, at the theme's strength (`scale` of it). */
function glowColour(key: MarkerKey, scale = 1): string {
  const strength = scale === 1 ? 'var(--priority-glow-strength)' : `calc(var(--priority-glow-strength) * ${scale})`
  return `color-mix(in srgb, ${MARKER_COLOR[key]} ${strength}, transparent)`
}

/** Pixels each colour takes along the row when several blend. */
const BLEND_STEP_PX = 30

/** The row background for these glow colours: one glows from the edge; several run into each other. */
export function rowGlow(colours: readonly string[]): string | undefined {
  const [first] = colours
  if (first === undefined) return undefined
  if (colours.length === 1) return `radial-gradient(60px 28px at 0 50%, ${first}, transparent)`
  const stops = colours.map((c, i) => `${c} ${i * BLEND_STEP_PX}px`).join(', ')
  return `linear-gradient(to right, ${stops}, transparent ${colours.length * BLEND_STEP_PX + BLEND_STEP_PX}px)`
}

export interface RowCue {
  /** The row's background; absent = none. */
  glow?: string
  semibold: boolean
}

const NO_CUE: RowCue = { semibold: false }

/** How much of its glow a task urgent only by its due date gets (its dot is a ring, too). */
const URGENT_BY_DATE_GLOW = 0.55

/** What `cues` add to a task's row, in the markers' order. A completed task has none. */
export function rowCue(
  todo: Pick<TodoItem, 'isCompleted' | 'focus' | 'urgent' | 'important' | 'dueDate'>,
  cues: PriorityCues,
  today: Date,
  range: UrgentDueWithinDays,
): RowCue {
  if (todo.isCompleted) return NO_CUE
  const urgent = urgentMark(todo, today, range)
  const on: Record<MarkerKey, boolean> = { focus: todo.focus === true, urgent: urgent != null, important: todo.important === true }
  const colours = MARKER_KEYS
    .filter((key) => on[key] && cues[key].glow)
    .map((key) => glowColour(key, key === 'urgent' && urgent === 'date' ? URGENT_BY_DATE_GLOW : 1))
  const semibold = MARKER_KEYS.some((key) => on[key] && cues[key].semibold)
  const glow = rowGlow(colours)
  if (!glow && !semibold) return NO_CUE
  return glow ? { glow, semibold } : { semibold }
}
