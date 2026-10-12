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
