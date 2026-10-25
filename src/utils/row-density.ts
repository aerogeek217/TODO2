/**
 * Row density of the desktop task rows (Settings › Appearance, app-wide):
 * `compact` = one-line titles in 28px rows (the default); `comfortable` =
 * titles wrap to two lines in rows of at least 44px, the cells on the first
 * line. The row list carries it as `data-density` (`TaskRowGrid`); the
 * phone row has one density.
 */
export type RowDensity = 'comfortable' | 'compact'

export const DEFAULT_ROW_DENSITY: RowDensity = 'compact'

export const ROW_DENSITIES: readonly RowDensity[] = ['comfortable', 'compact']

export function isRowDensity(v: unknown): v is RowDensity {
  return typeof v === 'string' && (ROW_DENSITIES as readonly string[]).includes(v)
}
