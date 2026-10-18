import { MARKER_KEYS, type MarkerKey, type MarkerSet } from '../models/filter-predicate'
import type { TodoItem } from '../models/todo-item'
import { isEffectivelyUrgent, type UrgentDueWithinDays } from './urgency'

/**
 * Hot: an app-wide, derived marker. Settings hold one rule — lines joined by
 * OR, each line an AND of markers (Urgent = effective urgent, Important,
 * Focus). Default: (Urgent AND Important) OR Focus. Only open tasks are hot.
 * Follow-up dates never make a task hot; the Eisenhower quadrants don't use
 * Hot.
 */

/** The Hot rule: a task is hot when it has every marker of at least one line. */
export type HotRule = readonly MarkerSet[]

/** (Urgent AND Important) OR Focus. */
export const DEFAULT_HOT_RULE: HotRule = [{ urgent: true, important: true }, { focus: true }]

/** The fields a marker / Hot check reads. */
export type MarkerFields = Pick<TodoItem, 'urgent' | 'important' | 'focus' | 'dueDate' | 'isCompleted'>

/** Whether `todo` has a marker (Urgent = effective urgent, flag or due date). */
export function hasMarker(todo: MarkerFields, key: MarkerKey, today: Date, range: UrgentDueWithinDays): boolean {
  switch (key) {
    case 'urgent': return isEffectivelyUrgent(todo, today, range)
    case 'important': return todo.important === true
    case 'focus': return todo.focus === true
  }
}

/** The markers of a line, in display order (Focus › Urgent › Important). */
export function lineMarkers(line: MarkerSet): MarkerKey[] {
  return MARKER_KEYS.filter((k) => line[k] === true)
}

/** Whether an open `todo` has every marker of `line` (an empty line matches nothing). */
export function matchesHotLine(todo: MarkerFields, line: MarkerSet, today: Date, range: UrgentDueWithinDays): boolean {
  if (todo.isCompleted) return false
  const keys = lineMarkers(line)
  return keys.length > 0 && keys.every((k) => hasMarker(todo, k, today, range))
}

/** Whether `todo` is hot: open and matching any line of `rule`. */
export function isHot(todo: MarkerFields, rule: HotRule, today: Date, range: UrgentDueWithinDays): boolean {
  return rule.some((line) => matchesHotLine(todo, line, today, range))
}

/**
 * The key order of a stored line. Fixed apart from the display order, so a
 * stored or exported rule keeps the same text whatever order the markers show
 * in.
 */
const STORED_KEY_ORDER: readonly MarkerKey[] = ['urgent', 'important', 'focus']

/** `line` in canonical form: its markers in stored key order, `true` only. */
function canonicalLine(line: MarkerSet): MarkerSet {
  const out: MarkerSet = {}
  for (const k of STORED_KEY_ORDER) if (line[k] === true) out[k] = true
  return out
}

/** A line as a stable key (`urgent+important`). */
function lineKey(line: MarkerSet): string {
  return lineMarkers(line).join('+')
}

/**
 * `rule` as stored: lines without a marker dropped, duplicate lines collapsed
 * (first one kept), keys in stored key order. Empty when no line has a marker —
 * not a valid rule.
 */
export function normalizeHotRule(rule: HotRule): MarkerSet[] {
  const seen = new Set<string>()
  const out: MarkerSet[] = []
  for (const line of rule) {
    const key = lineKey(line)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(canonicalLine(line))
  }
  return out
}

/** Whether two rules have the same lines in the same order (after normalizing). */
export function hotRulesEqual(a: HotRule, b: HotRule): boolean {
  return formatHotRule(a) === formatHotRule(b)
}

/** The settings row value: the normalized rule as JSON. */
export function formatHotRule(rule: HotRule): string {
  return JSON.stringify(normalizeHotRule(rule))
}

/**
 * A stored / imported rule → the rule, or `undefined` when it isn't valid:
 * an array of at least one line, each line an object of known markers set to
 * `true`, with at least one marker. Duplicate lines are collapsed.
 */
export function readHotRule(raw: unknown): MarkerSet[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  for (const line of raw) {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return undefined
    const entries = Object.entries(line as Record<string, unknown>)
    if (entries.length === 0) return undefined
    if (!entries.every(([k, v]) => (MARKER_KEYS as readonly string[]).includes(k) && v === true)) return undefined
  }
  return normalizeHotRule(raw as MarkerSet[])
}

/** The settings row value → the rule; `undefined` when it isn't valid (see `readHotRule`). */
export function parseHotRule(value: string): MarkerSet[] | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return undefined
  }
  return readHotRule(raw)
}
