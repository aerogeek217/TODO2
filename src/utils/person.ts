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

/** A dot-atom local part: runs of letters, digits and RFC 5322 `atext` symbols, joined by single dots. */
const LOCAL_PART = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u
/** One domain label: letters, digits and hyphens, not starting or ending with a hyphen. */
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u

/**
 * Whether `value` (trimmed) is one plain email address: `local@domain.tld`,
 * the local part a dot-atom (no quotes), the domain two or more labels, at
 * most `PERSON_EMAIL_MAX` characters. Nothing that could name a second
 * recipient or a display name gets through — no `,` `;` `"` `<>` `()`
 * `[]` `\` `:`, whitespace or control characters. Letters beyond ASCII are
 * allowed (internationalised addresses).
 *
 * The person editor requires it, import drops an email failing it, and the
 * check-in `mailto:` / `.eml` builders refuse one.
 */
export function isValidEmail(value: string): boolean {
  const address = value.trim()
  if (address.length > PERSON_EMAIL_MAX) return false
  const at = address.indexOf('@')
  if (at <= 0 || at !== address.lastIndexOf('@')) return false
  const labels = address.slice(at + 1).split('.')
  return LOCAL_PART.test(address.slice(0, at)) && labels.length >= 2 && labels.every((l) => DOMAIN_LABEL.test(l))
}

/**
 * The address a check-in email goes to: `email` trimmed when it is one valid
 * address (`isValidEmail`), else `''` — no recipient, typed in the mail app.
 * A missing or invalid address never becomes some other text in a To field.
 */
export function checkinAddress(email: string | undefined): string {
  return email != null && isValidEmail(email) ? email.trim() : ''
}

/** `person` with `email` normalized: trimmed, or the key dropped when empty. */
export function withEmail<T extends { email?: string }>(person: T, email: string | null | undefined): T {
  const next = { ...person }
  const normalized = normalizeEmail(email)
  if (normalized) next.email = normalized
  else delete next.email
  return next
}
