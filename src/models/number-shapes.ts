/**
 * What a Number shows of the tasks its filter keeps (D26 P6, board Y): its
 * shapes and each shape's own fields — the choices, their defaults and the
 * checks that read them from untrusted input. `NumberConfig`
 * (`models/glance-widgets`) holds the active shape's fields only.
 */

import type { TodoPredicate } from './filter-predicate'

type Obj = Record<string, unknown>

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * A Number's shapes: its count; its count as a share of a second filter's
 * (`of`); the age of its stalest task (`oldestBy`); its count against a
 * goal (`goal`); several counts side by side (`items`); what one of the
 * layout's lists shows (`list`).
 */
export const NUMBER_SHOWS = ['count', 'share', 'oldest', 'goal', 'group', 'list'] as const
export type NumberShow = (typeof NUMBER_SHOWS)[number]

/** Each shape's name in the editor's Show picker. */
export const NUMBER_SHOW_LABELS: Record<NumberShow, string> = {
  count: 'Count',
  share: 'Share of…',
  oldest: 'Oldest',
  goal: 'Against a goal',
  group: 'Several counts',
  list: 'Follow a list',
}

/** The config field each shape adds (`count` none); a field of another shape is a stray. */
export const NUMBER_SHAPE_FIELDS = ['of', 'oldestBy', 'goal', 'items', 'list'] as const
export type NumberShapeField = (typeof NUMBER_SHAPE_FIELDS)[number]

export const NUMBER_SHAPE_FIELD: Record<NumberShow, NumberShapeField | null> = {
  count: null,
  share: 'of',
  oldest: 'oldestBy',
  goal: 'goal',
  group: 'items',
  list: 'list',
}

// ── Oldest ──────────────────────────────────────────────────────────────────

/**
 * The date an Oldest Number ages its tasks by (the filter's date names):
 * the last follow-up (a task never followed up ages from its creation),
 * creation, the last change, or the due date (a task without one isn't aged).
 */
export const NUMBER_OLDEST_BY = ['lastFollowup', 'created', 'modified', 'deadline'] as const
export type NumberOldestBy = (typeof NUMBER_OLDEST_BY)[number]

export const DEFAULT_NUMBER_OLDEST_BY: NumberOldestBy = 'lastFollowup'

/** Each date's choice in the editor. */
export const NUMBER_OLDEST_BY_LABELS: Record<NumberOldestBy, string> = {
  lastFollowup: 'Last follow-up',
  created: 'Created',
  modified: 'Modified',
  deadline: 'Due date',
}

export function isNumberOldestBy(v: unknown): v is NumberOldestBy {
  return includes(NUMBER_OLDEST_BY, v)
}

// ── Goal ────────────────────────────────────────────────────────────────────

/** The largest goal kept. */
export const NUMBER_GOAL_MAX = 1_000_000

/**
 * A Number's goal: at most or at least a whole number; with a `period` of a
 * week, its pace — the share of it due by the end of today — is marked.
 */
export type NumberGoal = ({ atMost: number; atLeast?: never } | { atLeast: number; atMost?: never }) & { period?: 'week' }

/** A new goal: at least 10 a week. */
export const DEFAULT_NUMBER_GOAL: NumberGoal = { atLeast: 10, period: 'week' }

function isGoalValue(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= NUMBER_GOAL_MAX
}

/** A stored goal: one of `atMost` / `atLeast`, a whole number, and an optional `week` period — no other key. */
export function isNumberGoal(v: unknown): v is NumberGoal {
  if (!isObj(v)) return false
  const keys = Object.keys(v)
  const bound = keys.filter((k) => k === 'atMost' || k === 'atLeast')
  if (bound.length !== 1 || !isGoalValue(v[bound[0] ?? ''])) return false
  if (v.period !== undefined && v.period !== 'week') return false
  return keys.every((k) => k === 'atMost' || k === 'atLeast' || k === 'period')
}

/** A goal's bound: which way, and the number. */
export function goalBound(goal: NumberGoal): { way: 'atMost' | 'atLeast'; value: number } {
  return goal.atMost != null ? { way: 'atMost', value: goal.atMost } : { way: 'atLeast', value: goal.atLeast ?? 0 }
}

/** A goal read from untrusted input: a stored one as it is, else the default (`fixed`). */
export function pickNumberGoal(v: unknown): { goal: NumberGoal; fixed: boolean } {
  if (isNumberGoal(v)) return { goal: v, fixed: false }
  if (isObj(v)) {
    // The parts that read: a bound (at most first), a week period.
    const period = v.period === 'week' ? { period: 'week' as const } : {}
    if (isGoalValue(v.atMost)) return { goal: { atMost: v.atMost, ...period }, fixed: true }
    if (isGoalValue(v.atLeast)) return { goal: { atLeast: v.atLeast, ...period }, fixed: true }
  }
  return { goal: DEFAULT_NUMBER_GOAL, fixed: true }
}

// ── Group ───────────────────────────────────────────────────────────────────

/** The most counts a group holds. */
export const NUMBER_GROUP_MAX = 6

/** One count of a group: its own name, filter and colour (absent = Auto). */
export interface NumberGroupItem {
  name: string
  filter: TodoPredicate
  color?: string
}

// ── List ────────────────────────────────────────────────────────────────────

/** The list a Number follows: one of its layout's lists. */
export interface NumberListRef {
  listDefinitionId: number
}

/** A stored list reference: `{ listDefinitionId }`, a whole number above 0. */
export function isNumberListRef(v: unknown): v is NumberListRef {
  return isObj(v) && Object.keys(v).length === 1
    && typeof v.listDefinitionId === 'number' && Number.isInteger(v.listDefinitionId) && v.listDefinitionId > 0
}
