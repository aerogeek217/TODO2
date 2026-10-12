export function generateInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 3)
}

/** People as person-picker rows (`ChipSelector` with `avatars`). */
export function personPickerItems(
  people: readonly { id?: number; name: string; initials: string; color?: string }[],
): { id: number; name: string; initials: string; color?: string }[] {
  return people
    .filter((p): p is typeof p & { id: number } => p.id !== undefined)
    .map((p) => ({ id: p.id, name: p.name, initials: p.initials, color: p.color }))
}

/** The person picker's search placeholder. */
export const PERSON_PICKER_PLACEHOLDER = 'Search or create people…'

/** Longest email address a person can hold (the practical SMTP limit). */
export const PERSON_EMAIL_MAX = 254

/** An email as stored: trimmed, and absent when empty. */
export function normalizeEmail(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed
}

/**
 * A light `x@y.z` shape check — no spaces, one `@`, a dot in the domain.
 * The person editor uses it; imports accept any string.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(value.trim())
}

/** `person` with `email` normalized: trimmed, or the key dropped when empty. */
export function withEmail<T extends { email?: string }>(person: T, email: string | null | undefined): T {
  const next = { ...person }
  const normalized = normalizeEmail(email)
  if (normalized) next.email = normalized
  else delete next.email
  return next
}
