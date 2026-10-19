import { NEGATABLE_FIELDS, type FilterNegation, type NegatableField } from '../models/filter-predicate'
import { toggleItem } from './filter'

/**
 * The "is not" switches of the People / Status / Tags filters, shared by
 * stored predicates (id arrays) and the screen filter's criteria (id Sets).
 *
 * A switch only means something on a field that filters: an "is not" with
 * nothing ticked is no filter (the field is stored as `null` and the switch
 * dropped), and clearing a field drops its switch. `withNormalizedNegation`
 * applies both rules; every writer runs it.
 */

/** An id filter's ids: a stored predicate's array or the screen filter's Set. */
export type IdList = ReadonlyArray<number> | ReadonlySet<number>

/** The id filters and their switches, as a predicate and screen criteria both carry them. */
export interface NegatableClauses {
  personIds: IdList | null
  statusIds: IdList | null
  tags?: IdList | null
  negate?: FilterNegation
}

/** How many ids; 0 for anything else (a stored row only the audit has checked). */
function sizeOf(ids: IdList): number {
  if (ids instanceof Set) return ids.size
  return Array.isArray(ids) ? ids.length : 0
}

/** Whether `field` reads "is not": its switch is on and it filters (some id ticked). */
export function isNegated(c: NegatableClauses, field: NegatableField): boolean {
  const ids = c[field]
  return c.negate?.[field] === true && ids != null && sizeOf(ids) > 0
}

/**
 * `c` with its switches normalised: a switched field with nothing ticked
 * becomes no filter, a switch stays only on a field that filters, and the
 * `negate` key is left out when no field reads "is not". Returns `c` itself
 * when nothing changes.
 */
export function withNormalizedNegation<T extends NegatableClauses>(c: T): T {
  if (c.negate === undefined) return c
  let out: T = c
  const negate: FilterNegation = {}
  for (const field of NEGATABLE_FIELDS) {
    if (c.negate[field] !== true) continue
    const ids = c[field]
    if (ids != null && sizeOf(ids) === 0) out = { ...out, [field]: null }
    else if (ids != null) negate[field] = true
  }
  const kept = Object.keys(negate).length
  if (out === c && kept > 0 && kept === Object.keys(c.negate).length) return c
  const next = { ...out }
  if (kept > 0) next.negate = negate
  else delete next.negate
  return next
}

/**
 * `c` with `field` set to `ids` and its switch to `negated`, normalised
 * (see `withNormalizedNegation`): `ids` null or — for "is not" — empty
 * clears the field and its switch.
 */
export function withIdFilter<T extends NegatableClauses>(
  c: T,
  field: NegatableField,
  ids: T[NegatableField],
  negated: boolean,
): T {
  const negate: FilterNegation = { ...c.negate }
  if (negated) negate[field] = true
  else delete negate[field]
  return withNormalizedNegation({ ...c, [field]: ids, negate })
}

/** Whether two filters' switches read the same (only switches on fields that filter count). */
export function negationEqual(a: NegatableClauses, b: NegatableClauses): boolean {
  return NEGATABLE_FIELDS.every((f) => isNegated(a, f) === isNegated(b, f))
}

/**
 * An "is not" picker's tick: adds or removes `id` from the ticked ids;
 * nothing left ticked = no filter (`null`). (An "is" picker ticks the rows
 * it shows instead — `utils/filter.toggleItem`.)
 */
export function toggleExcluded(current: ReadonlySet<number> | null, id: number): Set<number> | null {
  const next = new Set(current ?? [])
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next.size > 0 ? next : null
}

/**
 * Whether an entity picker shows `id` ticked: "is" — the rows it shows (no
 * filter = every row); "is not" — the rows it hides (no filter = none).
 */
export function entityTicked(ids: ReadonlySet<number> | null, negated: boolean, id: number): boolean {
  return negated ? ids?.has(id) === true : ids === null || ids.has(id)
}

/**
 * An entity picker's tick: "is" — `toggleItem` (every row ticked again = no
 * filter); "is not" — add / remove (nothing ticked = no filter).
 */
export function entityToggle(ids: ReadonlySet<number> | null, negated: boolean, id: number, allIds: readonly number[]): Set<number> | null {
  return negated ? toggleExcluded(ids, id) : toggleItem(ids === null ? null : new Set(ids), id, [...allIds])
}

/** What a People / Status / Tags filter picker shows and what its controls write (`entityPickerSelection`). */
export interface EntityPickerSelection {
  /** The "is" preview is showing: nothing ticked, though nothing is filtered. */
  previewing: boolean
  allSelected: boolean
  noneSelected: boolean
  isChecked: (id: number) => boolean
  /** The ids after a tick on `id` — in the preview, just `id`. */
  toggled: (id: number) => Set<number> | null
  /** Select all: "is" — no filter; "is not" — every value. */
  all: Set<number> | null
  /** Deselect all: "is" — nothing ticked; "is not" — no filter. */
  none: Set<number> | null
}

/**
 * The one rule set for a People / Status / Tags filter picker — the top
 * bar's (desktop buttons, folded menu) and a list's filter chips: what is
 * ticked and what a tick, Select all or Deselect all writes, for its ids,
 * its Is / Is not mode and whether it opened in the "is" preview (an
 * unfiltered field opened to add one: nothing ticked, the first tick
 * narrows to it; never in "is not").
 */
export function entityPickerSelection(
  ids: ReadonlySet<number> | null,
  negated: boolean,
  preview: boolean,
  allIds: readonly number[],
): EntityPickerSelection {
  const previewing = preview && !negated
  return {
    previewing,
    allSelected: negated ? ids !== null && allIds.every((id) => ids.has(id)) : !previewing && ids === null,
    noneSelected: negated ? ids === null : previewing || (ids !== null && ids.size === 0),
    isChecked: (id) => !previewing && entityTicked(ids, negated, id),
    toggled: (id) => (previewing ? new Set([id]) : entityToggle(ids, negated, id, allIds)),
    all: negated ? new Set(allIds) : null,
    none: negated ? null : new Set(),
  }
}
