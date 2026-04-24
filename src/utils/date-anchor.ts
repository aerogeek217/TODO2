import type { DateAnchor, RelativeDateToken } from '../models/filter-predicate'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'

/**
 * Read a persisted date-range endpoint. Accepts the current `DateAnchor`
 * object shape and the legacy pre-DSL-extension ISO-string form, auto-upgrading
 * the latter to `{kind:'fixed', iso}`. Unknown shapes return `null` so callers
 * can treat garbage as "no filter" instead of crashing.
 *
 * Lives in `utils/` (not `stores/`) so the `data/` migration + restore paths
 * can call it without introducing a data→stores dependency.
 */
export function readDateAnchor(v: unknown): DateAnchor | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return { kind: 'fixed', iso: v }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.kind === 'fixed' && typeof o.iso === 'string') {
      return { kind: 'fixed', iso: o.iso }
    }
    if (o.kind === 'relative' && typeof o.token === 'string'
        && (RELATIVE_DATE_TOKENS as readonly string[]).includes(o.token)) {
      return { kind: 'relative', token: o.token as RelativeDateToken }
    }
  }
  return null
}
