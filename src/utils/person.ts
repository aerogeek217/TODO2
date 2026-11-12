/** The most characters a person's initials hold (the made ones, and an imported file's). */
export const INITIALS_MAX = 3

export function generateInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, INITIALS_MAX)
}

/**
 * Initials as the app keeps them: trimmed, uppercase, at most
 * `INITIALS_MAX` characters — made from `name` when nothing is left.
 */
export function normalizeInitials(initials: string, name: string): string {
  return initials.trim().toUpperCase().slice(0, INITIALS_MAX) || generateInitials(name)
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
