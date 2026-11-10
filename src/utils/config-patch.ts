/**
 * Plain-data equality for stored configs (objects, arrays, strings,
 * numbers, booleans, null): a key holding `undefined` reads as absent, as a
 * config patch writes it (`patchTabConfig` drops such keys).
 */
export function sameConfigValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => sameConfigValue(v, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const k of keys) {
    if (!sameConfigValue(ra[k], rb[k])) return false
  }
  return true
}

/**
 * The patch that turns `base` into `next`: each top-level key whose value
 * differs, with `next`'s value (`undefined` for one `next` drops). Empty
 * when they read the same. Applied over a config that changed elsewhere
 * since `base` (a ⋯ menu's write), it keeps those other keys.
 */
export function configPatch<C extends object>(base: C, next: C): Partial<C> {
  const rb = base as Record<string, unknown>
  const rn = next as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(rb), ...Object.keys(rn)])) {
    if (!sameConfigValue(rb[k], rn[k])) patch[k] = rn[k]
  }
  return patch as Partial<C>
}
