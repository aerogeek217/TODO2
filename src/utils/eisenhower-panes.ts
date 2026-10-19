import { emptyPredicate, MARKER_KEYS, type MarkerConditions, type TodoPredicate } from '../models/filter-predicate'
import {
  EISENHOWER_QUADRANTS,
  type EisenhowerPaneConfig,
  type EisenhowerPanes,
  type EisenhowerQuadrant,
} from '../models/workspace-layout'
import { filterChips, type FilterChip, type FilterChipNames } from './filter-chips'
import type { FilterDefaults } from './filter-defaults'
import { isNegated, withNormalizedNegation } from './filter-negation'
import { predicatesEqual } from './list-def-equal'
import { activeMarkers, markerConditions } from './markers'
import { plainLine } from './text'

/**
 * The Eisenhower matrix's four panes, by position (Do, Schedule, Delegate,
 * Drop — top-left, top-right, bottom-left, bottom-right). Each pane has a
 * name and a filter in the list filter model; by default they are the
 * classic quadrants of effective Urgent × Important. A tab stores only the
 * parts that differ (`EisenhowerTabConfig.panes`).
 */

/** The default quadrants' Urgent / Important. */
export interface QuadrantFlags {
  urgent: boolean
  important: boolean
}

export const QUADRANT_FLAGS: Record<EisenhowerQuadrant, QuadrantFlags> = {
  do: { urgent: true, important: true },
  schedule: { urgent: false, important: true },
  delegate: { urgent: true, important: false },
  drop: { urgent: false, important: false },
}

/** The default pane names. */
export const QUADRANT_NAME: Record<EisenhowerQuadrant, string> = {
  do: 'Do',
  schedule: 'Schedule',
  delegate: 'Delegate',
  drop: 'Drop',
}

/** A position's label colour (its pane name in the widget, its heading in a task dialog). */
export const QUADRANT_COLOR: Record<EisenhowerQuadrant, string> = {
  do: 'var(--color-danger)',
  schedule: 'var(--color-followup)',
  delegate: 'var(--color-text-secondary)',
  drop: 'var(--color-text-muted)',
}

/** The plain-words subtitle of a default pane. */
export const QUADRANT_SUBTITLE: Record<EisenhowerQuadrant, string> = {
  do: 'Urgent and important',
  schedule: 'Important, not urgent',
  delegate: 'Urgent, not important',
  drop: 'Neither',
}

/** A position's default filter: its quadrant's Urgent / Important, each Yes or No. */
export function defaultPaneFilter(q: EisenhowerQuadrant): TodoPredicate {
  const flags = QUADRANT_FLAGS[q]
  return { ...emptyPredicate(), markers: { urgent: flags.urgent, important: flags.important } }
}

/** A pane as the matrix uses it: its stored settings over its position's defaults. */
export interface EisenhowerPane {
  id: EisenhowerQuadrant
  name: string
  filter: TodoPredicate
  /** The name differs from the position's default. */
  customName: boolean
  /** The filter differs from the position's default (the pane header's dot). */
  customFilter: boolean
}

/** A pane filter as stored: `showCompleted` off (ignored), "is not" switches normalised. */
function storedFilter(filter: TodoPredicate): TodoPredicate {
  return withNormalizedNegation({ ...filter, showCompleted: false })
}

/** Whether two pane filters filter the same (`showCompleted` is ignored). */
export function paneFiltersEqual(a: TodoPredicate, b: TodoPredicate): boolean {
  return predicatesEqual(storedFilter(a), storedFilter(b))
}

/**
 * A pane's stored settings in their stored form: the name as one plain line
 * (`plainLine`: trimmed, no line breaks, control or bidi characters — no
 * length cap) and kept only when not empty and not the default name, the
 * filter kept only when it differs from the default; `undefined` when
 * nothing differs.
 */
export function normalizePaneConfig(q: EisenhowerQuadrant, config: EisenhowerPaneConfig): EisenhowerPaneConfig | undefined {
  const out: EisenhowerPaneConfig = {}
  const name = config.name !== undefined ? plainLine(config.name) : undefined
  if (name && name !== QUADRANT_NAME[q]) out.name = name
  if (config.filter && !paneFiltersEqual(config.filter, defaultPaneFilter(q))) out.filter = storedFilter(config.filter)
  return out.name !== undefined || out.filter !== undefined ? out : undefined
}

/** The four panes in position order, from a tab's stored `panes`. */
export function resolvePanes(panes: EisenhowerPanes | undefined): EisenhowerPane[] {
  return EISENHOWER_QUADRANTS.map((q) => {
    const stored = panes?.[q] ? normalizePaneConfig(q, panes[q]) : undefined
    return {
      id: q,
      name: stored?.name ?? QUADRANT_NAME[q],
      filter: stored?.filter ?? defaultPaneFilter(q),
      customName: stored?.name !== undefined,
      customFilter: stored?.filter !== undefined,
    }
  })
}

/**
 * `panes` with pane `q`'s settings patched (`null` = reset the pane to its
 * defaults), normalised; `undefined` once every pane is its default (the
 * config key goes).
 */
export function withPaneConfig(
  panes: EisenhowerPanes | undefined,
  q: EisenhowerQuadrant,
  patch: EisenhowerPaneConfig | null,
): EisenhowerPanes | undefined {
  const out: EisenhowerPanes = {}
  for (const id of EISENHOWER_QUADRANTS) {
    const base = panes?.[id]
    const next = id !== q ? base : patch === null ? undefined : { ...base, ...patch }
    const normalized = next ? normalizePaneConfig(id, next) : undefined
    if (normalized) out[id] = normalized
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A filter's clauses as short values: `Urgent`, `not Important`, `not Delegated`, `Due within 7 days`. */
function chipWords(chip: FilterChip): string[] {
  switch (chip.field) {
    case 'markers': return chip.value.split(', ')
    case 'dates': return [`${chip.label} ${chip.value}`]
    case 'text': return [`Text ${chip.value}`]
    default: return [chip.value]
  }
}

/**
 * A pane's subtitle: a default pane's plain words (`Urgent and important`),
 * else its filter in words — `Urgent · not Important · not Delegated` —
 * or `Every task` for a pane with no filter.
 */
export function paneSubtitle(pane: EisenhowerPane, names: FilterChipNames): string {
  if (!pane.customFilter) return QUADRANT_SUBTITLE[pane.id]
  const words = filterChips(pane.filter, names).flatMap(chipWords)
  return words.length > 0 ? words.join(' · ') : 'Every task'
}

/**
 * What a pane's filter writes on a task dropped on it or added with its "+":
 * each Priority marker it tests set Yes (`true`) or No (`false`); the status
 * when it is "Status is" one status; a person when it is "People is" one
 * person; a tag when it is "Tags is" one tag. A Hot filter, "is not",
 * several values, "No status" / "Unassigned" / "Untagged", dates and text
 * imply nothing.
 */
export interface PaneWrites {
  markers: MarkerConditions
  statusId?: number
  personId?: number
  tagId?: number
}

/** The one id an "is" filter on `field` holds, else `undefined`. */
function singleId(filter: TodoPredicate, field: 'personIds' | 'statusIds' | 'tags'): number | undefined {
  const ids = filter[field]
  if (ids == null || ids.length !== 1 || isNegated(filter, field)) return undefined
  const [only] = ids
  return only !== 0 ? only : undefined
}

export function paneWrites(filter: TodoPredicate): PaneWrites {
  const out: PaneWrites = { markers: markerConditions(filter.markers) }
  const statusId = singleId(filter, 'statusIds')
  const personId = singleId(filter, 'personIds')
  const tagId = singleId(filter, 'tags')
  if (statusId !== undefined) out.statusId = statusId
  if (personId !== undefined) out.personId = personId
  if (tagId !== undefined) out.tagId = tagId
  return out
}

/** Whether a pane's filter writes anything. */
export function hasPaneWrites(w: PaneWrites): boolean {
  return activeMarkers(w.markers).length > 0 || w.statusId !== undefined || w.personId !== undefined || w.tagId !== undefined
}

/**
 * New-task defaults for a pane's "+": `fd` (the source's: a list's own
 * Add task seeds, or the screen filter's) with the pane's writes over it —
 * each marker the pane tests is decided by the pane (Yes seeds the flag; No
 * drops the source's seed, so the task starts without it), the pane's status
 * replaces the source's, its person / tag join the source's.
 */
export function withPaneSeed(fd: FilterDefaults, writes: PaneWrites): FilterDefaults {
  const markers: MarkerConditions = {}
  for (const k of MARKER_KEYS) {
    const pane = writes.markers[k]
    const v = pane === undefined ? fd.markers?.[k] : pane || undefined
    if (v !== undefined) markers[k] = v
  }
  const join = (ids: readonly number[], id: number | undefined) => (id === undefined || ids.includes(id) ? [...ids] : [...ids, id])
  const out: FilterDefaults = {
    personIds: join(fd.personIds, writes.personId),
    tagIds: join(fd.tagIds, writes.tagId),
    statusId: writes.statusId ?? fd.statusId,
  }
  return activeMarkers(markers).length > 0 ? { ...out, markers } : out
}
