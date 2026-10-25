import type { CalendarDateType, CalendarDateTypes } from '../models/workspace-layout'
import { startOfDay } from './date'

/**
 * The calendar's heat map (D18): with titles off, a month day is tinted by
 * how many entries it holds on four fixed steps — fixed, not per-month
 * quantiles, so a quiet month looks quiet — and a past day whose tasks are
 * still open shows its number in their colour. The entries are the bars the
 * day would show (screen-filtered; completed ones only under Show completed).
 */

/** 0 = no entries · 1 = 1–2 · 2 = 3–5 · 3 = 6 or more. */
export type HeatStep = 0 | 1 | 2 | 3

/** The lowest count of steps 1, 2 and 3. */
export const HEAT_STEP_MIN = [1, 3, 6] as const

export function heatStep(count: number): HeatStep {
  if (count >= HEAT_STEP_MIN[2]) return 3
  if (count >= HEAT_STEP_MIN[1]) return 2
  if (count >= HEAT_STEP_MIN[0]) return 1
  return 0
}

/** The tint's hue: the follow-up colour when only follow-ups are shown, else the overdue colour. */
export function heatHue(types: CalendarDateTypes): CalendarDateType {
  return types.followup && !types.due ? 'followup' : 'due'
}

/** What the heat reads of an entry (a `CalendarEntry` fits). */
export interface HeatEntry {
  kind: CalendarDateType
  /** A recurring task's generated occurrence: never late. */
  isVirtual: boolean
  todo: { isCompleted: boolean }
}

export interface DayHeat {
  count: number
  step: HeatStep
  due: number
  followup: number
  /** Entries whose task isn't completed. */
  open: number
  /**
   * A past day holding an open task's own date: `'due'` when any is a due
   * date, else `'followup'`; `null` otherwise (as the wash it replaces).
   */
  late: CalendarDateType | null
}

export function dayHeat(entries: readonly HeatEntry[], day: Date, today: Date): DayHeat {
  let due = 0
  let open = 0
  let lateDue = false
  let lateFollowup = false
  const past = startOfDay(day).getTime() < startOfDay(today).getTime()
  for (const e of entries) {
    if (e.kind === 'due') due++
    if (e.todo.isCompleted) continue
    open++
    if (past && !e.isVirtual) {
      if (e.kind === 'due') lateDue = true
      else lateFollowup = true
    }
  }
  return {
    count: entries.length,
    step: heatStep(entries.length),
    due,
    followup: entries.length - due,
    open,
    late: lateDue ? 'due' : lateFollowup ? 'followup' : null,
  }
}

/**
 * A heat day's tooltip and label: `6 due`, `2 follow-ups`, `4 due · 1
 * follow-up`; `· 5 open` when some are completed (under Show completed).
 * Empty for a day with none.
 */
export function heatSummary(heat: DayHeat): string {
  const parts: string[] = []
  if (heat.due > 0) parts.push(`${heat.due} due`)
  if (heat.followup > 0) parts.push(`${heat.followup} ${heat.followup === 1 ? 'follow-up' : 'follow-ups'}`)
  if (parts.length > 0 && heat.open !== heat.count) parts.push(`${heat.open} open`)
  return parts.join(' · ')
}

/** The legend's lead: what the tint counts. */
export function heatLegendLabel(types: CalendarDateTypes): string {
  if (types.due && types.followup) return 'Due and follow-ups'
  return types.followup ? 'Follow-ups' : 'Tasks due'
}

/** The legend's swatches: each step's counts. */
export const HEAT_LEGEND: ReadonlyArray<{ step: HeatStep; label: string }> = [
  { step: 0, label: '0' },
  { step: 1, label: '1–2' },
  { step: 2, label: '3–5' },
  { step: 3, label: '6+' },
]
