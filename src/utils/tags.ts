/**
 * Pure tag utilities — shared between `todo-store` (add/remove/set/rename
 * helpers), the NLP (`#foo` capture), import validation (shape check), and
 * filter/search code. Tags are stored inline on `TodoItem` as a lowercase
 * slug array; this module centralises the normalization rule so every writer
 * produces values that match the NLP's `#foo` regex.
 */

/** Slug rule — mirrors the `#foo` NLP capture group. */
export const TAG_SLUG_RE = /^[a-z0-9_-]+$/

/** Max tag length — keeps stored tags compact; matches import-validation. */
export const TAG_MAX_LEN = 64

/**
 * Normalize a raw tag: trim, lowercase, validate against `TAG_SLUG_RE`.
 * Returns `null` for anything that can't round-trip through the NLP
 * (empty/whitespace-only, over-length, non-slug chars like spaces or `!`).
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0 || trimmed.length > TAG_MAX_LEN) return null
  if (!TAG_SLUG_RE.test(trimmed)) return null
  return trimmed
}

/**
 * Normalize an array of raw tags. Invalid entries drop; duplicates collapse
 * to first-seen order. Pure.
 */
export function normalizeTags(raw: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    const slug = normalizeTag(t)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

/**
 * Rewrite every occurrence of `src` to `dst` in `tags` and dedupe (first-seen
 * wins). Pure; does not mutate input. Returns `changed: false` when `src` is
 * absent so callers can skip writes.
 */
export function renameTagInArray(
  tags: readonly string[],
  src: string,
  dst: string,
): { changed: boolean; next: string[] } {
  if (!tags.includes(src)) return { changed: false, next: [...tags] }
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const rewritten = t === src ? dst : t
    if (seen.has(rewritten)) continue
    seen.add(rewritten)
    out.push(rewritten)
  }
  return { changed: true, next: out }
}

/** Order-sensitive equality over optional tag arrays (`undefined` == `[]`). */
export function tagsEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false
  return true
}
