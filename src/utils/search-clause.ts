import type { DateMatch, MarkerKey } from '../models'
import { withDateMatch } from './date-filters'
import type { FilterCriteria } from './filter-criteria'
import { isHotFilter } from './markers'

/**
 * What one search token (`services/search-tokens`) sets on the screen filter
 * — the clause the chip's own picker would set — and how it merges in: a
 * person, tag or status joins its field's ids (OR, as the pickers tick them;
 * an "is not" field becomes "is" this one), a marker joins the Priority
 * filter (Hot replaces the markers, a marker replaces Hot), a date replaces
 * that date type's clause, `done` turns Show completed on.
 */

/** The parts of the screen filter a search token can set (a date type each). */
export type SearchField = 'personIds' | 'tags' | 'statusIds' | 'markers' | 'deadline' | 'followup' | 'showCompleted'

export type SearchClause =
  | { field: 'personIds' | 'tags' | 'statusIds'; id: number }
  | { field: 'markers'; marker: MarkerKey | 'hot' }
  | { field: 'deadline' | 'followup'; match: DateMatch }
  | { field: 'showCompleted' }

/** The value one search field holds in `f` (a snapshot to put back when its token is unwound). */
export type SearchFieldValue =
  | { field: 'personIds' | 'tags' | 'statusIds'; ids: Set<number> | null; negated: boolean }
  | { field: 'markers'; markers: FilterCriteria['markers'] }
  | { field: 'deadline' | 'followup'; match: DateMatch | undefined }
  | { field: 'showCompleted'; on: boolean }

export function searchFieldValue(f: FilterCriteria, field: SearchField): SearchFieldValue {
  switch (field) {
    case 'personIds':
    case 'tags':
    case 'statusIds':
      return { field, ids: f[field], negated: f.negate?.[field] === true }
    case 'markers': return { field, markers: f.markers }
    case 'deadline':
    case 'followup': return { field, match: f.dates[field] }
    case 'showCompleted': return { field, on: f.showCompleted }
  }
}

/** `f` with one search field set back to `value`. */
export function withSearchFieldValue(f: FilterCriteria, value: SearchFieldValue): FilterCriteria {
  switch (value.field) {
    case 'personIds':
    case 'tags':
    case 'statusIds': {
      const negate = { ...f.negate }
      if (value.negated) negate[value.field] = true
      else delete negate[value.field]
      return { ...f, [value.field]: value.ids, negate }
    }
    case 'markers': return { ...f, markers: value.markers }
    case 'deadline':
    case 'followup': return { ...f, dates: withDateMatch(f.dates, value.field, value.match ?? null) }
    case 'showCompleted': return { ...f, showCompleted: value.on }
  }
}

/** Whether one search field reads the same in `a` and `b`. */
export function sameSearchField(a: FilterCriteria, b: FilterCriteria, field: SearchField): boolean {
  const x = searchFieldValue(a, field)
  const y = searchFieldValue(b, field)
  return JSON.stringify(x, setsAsArrays) === JSON.stringify(y, setsAsArrays)
}

function setsAsArrays(_key: string, value: unknown): unknown {
  return value instanceof Set ? [...value as Set<unknown>].sort() : value
}

/** `f` with `clause` merged in (see the module comment). */
export function withSearchClause(f: FilterCriteria, clause: SearchClause): FilterCriteria {
  switch (clause.field) {
    case 'personIds':
    case 'tags':
    case 'statusIds': {
      const field = clause.field
      const negated = f.negate?.[field] === true
      const ids = new Set(negated ? [] : f[field] ?? [])
      ids.add(clause.id)
      const negate = { ...f.negate }
      delete negate[field]
      return { ...f, [field]: ids, negate }
    }
    case 'markers': {
      if (clause.marker === 'hot') return { ...f, markers: 'hot' }
      const current = isHotFilter(f.markers) || f.markers == null ? {} : f.markers
      return { ...f, markers: { ...current, [clause.marker]: true } }
    }
    case 'deadline':
    case 'followup':
      return { ...f, dates: withDateMatch(f.dates, clause.field, clause.match) }
    case 'showCompleted':
      return { ...f, showCompleted: true }
  }
}
