import { isRecord } from '../utils/is-record'
import { LENSES_MAX, LENS_ID_MAX, cleanLensName, lensPredicate, type Lens } from '../utils/lens'
import { checkPredicateShape, pickPredicate } from './predicate-shape'

/**
 * The stored `lenses` setting — JSON of an array of `{ id, name, predicate }`
 * — read and written the one way import validation (and so the audit), the
 * settings store's read and its writes use. Read leniently, as the
 * Eisenhower panes are: a lens without a usable id or name, with an id
 * another lens has, or whose predicate lacks the list predicate's core
 * shape is dropped; a malformed filter clause is dropped from its lens
 * (`pickPredicate`); completed tasks stay off; unknown keys go — each
 * counted in `fixes`. Text that isn't JSON or an array, or is over
 * `LENSES_SETTING_MAX_LEN`, reads as no lenses.
 */

/**
 * A lens id's shape (a short, non-empty string) — what the top bar's pick
 * (`activeLensId`) stores. Whether a lens has it is read where the pick is
 * used: an id no lens has is No lens.
 */
export function isLensId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= LENS_ID_MAX
}

/** The lenses read from their stored text, and what was dropped on the way (empty when nothing). */
export interface ReadLenses {
  lenses: Lens[]
  fixes: string[]
}

/** The longest `lenses` text read (a million characters, as the Eisenhower panes and the check-in filter). */
export const LENSES_SETTING_MAX_LEN = 1_000_000

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

/** Stored lenses, rebuilt (see the module comment). */
export function pickLenses(raw: unknown): ReadLenses {
  if (!Array.isArray(raw)) return { lenses: [], fixes: ['lenses reset'] }
  const lenses: Lens[] = []
  const ids = new Set<string>()
  let dropped = 0
  let fixed = 0
  for (const item of raw) {
    if (lenses.length >= LENSES_MAX) {
      dropped++
      continue
    }
    const id = isRecord(item) && isLensId(item.id) ? item.id : null
    const name = isRecord(item) && typeof item.name === 'string' ? cleanLensName(item.name) : null
    if (!isRecord(item) || id == null || ids.has(id) || name == null || checkPredicateShape(item.predicate) !== true) {
      dropped++
      continue
    }
    const { predicate, fixes } = pickPredicate(item.predicate)
    const kept = lensPredicate(predicate)
    if (fixes.length > 0 || predicate.showCompleted || name !== item.name
      || Object.keys(item).some((k) => k !== 'id' && k !== 'name' && k !== 'predicate')) fixed++
    ids.add(id)
    lenses.push({ id, name, predicate: kept })
  }
  const fixes = [
    ...(dropped > 0 ? [plural(dropped, 'lens dropped', 'lenses dropped')] : []),
    ...(fixed > 0 ? [plural(fixed, 'lens fixed', 'lenses fixed')] : []),
  ]
  return { lenses, fixes }
}

/** The stored text, read (see the module comment). */
export function readLensesSetting(value: string): ReadLenses {
  if (value.length > LENSES_SETTING_MAX_LEN) return { lenses: [], fixes: ['lenses too long — reset'] }
  const parsed = parseJson(value)
  if (parsed === undefined) return { lenses: [], fixes: ['lenses reset'] }
  return pickLenses(parsed)
}

/** The stored text of `lenses`: their known parts, completed tasks off. */
export function formatLensesSetting(lenses: readonly Lens[]): string {
  return JSON.stringify(pickLenses(lenses).lenses)
}
