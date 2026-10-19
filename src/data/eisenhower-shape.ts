import type { EisenhowerPaneConfig, EisenhowerPanes } from '../models/eisenhower-settings'
import { EISENHOWER_QUADRANTS, isEisenhowerQuadrant } from '../models/workspace-layout'
import { normalizePaneConfig } from '../utils/eisenhower-panes'
import { isRecord } from '../utils/is-record'
import { checkPredicateShape, pickPredicate } from './predicate-shape'

/**
 * The stored values of the two Eisenhower settings, checked and rebuilt —
 * the one implementation import validation (and so the audit), the
 * settings store's read and its writes use:
 *
 * - `eisenhowerPanes`: JSON of an object of panes by position, each with an
 *   optional `name` (a string) and `filter` (a list predicate).
 * - `eisenhowerSource`: `list:<id>` (a saved list); `all` reads as all tasks
 *   (the app stores that as no row).
 */

/**
 * `true` when `panes` (parsed) is an object whose known panes are objects
 * with a string `name` and a `filter` of the list predicate's core shape,
 * else the path of the first bad part (`delegate.filter.personIds`). Unknown
 * panes and unknown keys inside a pane pass (the pick drops them, as a fix);
 * the filter's inner clauses are sanitised by the pick too (`pickPredicate`).
 */
export function checkPanes(panes: unknown): true | string {
  if (!isRecord(panes)) return 'panes'
  for (const [key, pane] of Object.entries(panes)) {
    if (!isEisenhowerQuadrant(key)) continue
    if (!isRecord(pane)) return key
    if (pane.name !== undefined && typeof pane.name !== 'string') return `${key}.name`
    if (pane.filter !== undefined) {
      const filter = checkPredicateShape(pane.filter)
      if (filter !== true) return `${key}.filter.${filter}`
    }
  }
  return true
}

/** A part `pickPanes` dropped or reset, counted. */
type PaneFix = 'dropped' | 'reset'

const FIX_WORDS: Record<PaneFix, readonly [one: string, many: string]> = {
  dropped: ['Eisenhower pane setting dropped', 'Eisenhower pane settings dropped'],
  reset: ['Eisenhower pane reset', 'Eisenhower panes reset'],
}

export interface PickedPanes {
  /** The panes that differ from their defaults, in their stored form; `{}` = all default. */
  panes: EisenhowerPanes
  /**
   * What was dropped or reset, in words (`2 Eisenhower pane settings
   * dropped`); empty for panes that pass `checkPanes` and hold nothing
   * malformed.
   */
  fixes: string[]
}

/**
 * The stored panes, rebuilt: known panes in position order, each with its
 * name and filter (`pickPredicate`), normalised — a part equal to the
 * default goes (`normalizePaneConfig`). An unknown pane or key, or a filter
 * clause `pickPredicate` drops, is a `dropped` fix; a pane or part
 * `checkPanes` rejects is reset to its default (a `reset` fix; import never
 * picks such a value — it fails the file).
 */
export function pickPanes(raw: unknown): PickedPanes {
  const counts = new Map<PaneFix, number>()
  const fix = (what: PaneFix) => { counts.set(what, (counts.get(what) ?? 0) + 1) }
  const picked: EisenhowerPanes = {}
  if (isRecord(raw)) {
    for (const [key, pane] of Object.entries(raw)) {
      if (!isEisenhowerQuadrant(key)) {
        fix('dropped')
        continue
      }
      if (!isRecord(pane)) {
        fix('reset')
        continue
      }
      const config: EisenhowerPaneConfig = {}
      for (const k of Object.keys(pane)) if (k !== 'name' && k !== 'filter') fix('dropped')
      if (typeof pane.name === 'string') config.name = pane.name
      else if (pane.name !== undefined) fix('reset')
      if (pane.filter !== undefined) {
        if (checkPredicateShape(pane.filter) !== true) fix('reset')
        else {
          const { predicate, fixes } = pickPredicate(pane.filter)
          for (let i = 0; i < fixes.length; i++) fix('dropped')
          config.filter = predicate
        }
      }
      picked[key] = config
    }
  } else {
    fix('reset')
  }
  const panes: EisenhowerPanes = {}
  for (const q of EISENHOWER_QUADRANTS) {
    const config = picked[q]
    const normalized = config ? normalizePaneConfig(q, config) : undefined
    if (normalized) panes[q] = normalized
  }
  const fixes = [...counts].map(([what, n]) => {
    const [one, many] = FIX_WORDS[what]
    return n === 1 ? one : `${n} ${many}`
  })
  return { panes, fixes }
}

/** The stored text, parsed; `undefined` when it isn't JSON. */
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/** `true` when the stored `eisenhowerPanes` text is JSON that passes `checkPanes`, else what is wrong. */
export function checkPanesSetting(value: string): true | string {
  const parsed = parseJson(value)
  if (parsed === undefined) return 'not JSON'
  return checkPanes(parsed)
}

/**
 * The stored `eisenhowerPanes` text, read leniently (the settings store's
 * load): unreadable text gives the defaults, malformed parts are dropped or
 * reset (`pickPanes`).
 */
export function readPanesSetting(value: string): PickedPanes {
  const parsed = parseJson(value)
  if (parsed === undefined) return { panes: {}, fixes: ['Eisenhower panes reset'] }
  return pickPanes(parsed)
}

/** The `eisenhowerPanes` text for `panes` (stored form: what differs, in position order). */
export function formatPanesSetting(panes: EisenhowerPanes): string {
  return JSON.stringify(pickPanes(panes).panes)
}

/** The prefix of a list source: `list:<listDefinitionId>`. */
const LIST_SOURCE_PREFIX = 'list:'

/** A stored list id: a positive whole number. */
const LIST_ID = /^[1-9]\d{0,15}$/

/**
 * The stored `eisenhowerSource` text: a saved list's id, `null` for all tasks
 * (`all`), `undefined` when unreadable.
 */
export function parseEisenhowerSource(value: string): number | null | undefined {
  if (value === 'all') return null
  if (!value.startsWith(LIST_SOURCE_PREFIX)) return undefined
  const id = value.slice(LIST_SOURCE_PREFIX.length)
  if (!LIST_ID.test(id)) return undefined
  const n = Number(id)
  return Number.isSafeInteger(n) ? n : undefined
}

/** The `eisenhowerSource` text for a saved list. */
export function formatEisenhowerSource(listDefinitionId: number): string {
  return `${LIST_SOURCE_PREFIX}${listDefinitionId}`
}
