import { NEGATABLE_FIELDS, type FilterNegation, type NegatableField } from '../models/filter-predicate'

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

function sizeOf(ids: IdList): number {
  return 'size' in ids ? ids.size : ids.length
}

/** Whether `field` reads "is not": its switch is on and it filters (some id ticked). */
export function isNegated(c: NegatableClauses, field: NegatableField): boolean {
  const ids = c[field]
  return c.negate?.[field] === true && ids != null && sizeOf(ids) > 0
}

/** Whether any field reads "is not". */
export function hasNegation(c: NegatableClauses): boolean {
  return NEGATABLE_FIELDS.some((f) => isNegated(c, f))
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
