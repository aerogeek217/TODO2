/**
 * Pure tag utilities — shared between the NLP `#foo` capture and any caller
 * that needs to case-fold a user-entered slug. The normalized slug feeds the
 * tag-registry lookup (`nlp-resolver.resolveTags`).
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
